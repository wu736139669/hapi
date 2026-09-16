import { randomBytes } from 'node:crypto'
import type { AgentFlavor, PermissionMode, SyncEvent } from '@hapi/protocol/types'

import {
    TeamStore,
    type CreateTeamInput,
    type TeamMemberRecord,
    type TeamMessageRecord,
    type TeamRecord,
    type TeamTaskRecord,
    type TeamTaskStatus
} from './teamStore'

export interface TeamDetail {
    team: TeamRecord
    members: TeamMemberRecord[]
    tasks: TeamTaskRecord[]
}

export interface CreateTeamServiceInput {
    name: string
    leadSessionId?: string
    config?: Record<string, unknown>
}

export interface TeamSessionView {
    id: string
    active: boolean
    thinking: boolean
    machineId: string | null
    directory: string | null
    flavor: AgentFlavor | null
    inWorktree: boolean
    /** Runtime config of the session, used as the inheritance source for spawned members. */
    model?: string | null
    modelReasoningEffort?: string | null
    effort?: string | null
    permissionMode?: PermissionMode | null
}

export interface TeamSpawnMemberInput {
    machineId: string
    directory: string
    agent: AgentFlavor
    model?: string
    modelReasoningEffort?: string
    effort?: string
    permissionMode?: PermissionMode
    sessionType: 'simple' | 'worktree'
    worktreeName?: string
    yolo?: boolean
    teamId: string
    teamName: string
    teamRole: string
    teamNamespace: string
}

export interface TeamRuntime {
    resolveSession(sessionId: string): TeamSessionView | null
    /** Latest assistant plain text of a session (for bridging replies). */
    lastAssistantText(sessionId: string): string | null
    spawnMember(input: TeamSpawnMemberInput): Promise<{ ok: true; sessionId: string } | { ok: false; message: string }>
    deliverPeerMessage(input: { sessionId: string; text: string }): Promise<void>
    /** Archive/stop a session (used when a member is removed and stopped). */
    archiveSession?: (sessionId: string) => Promise<void>
    sleep(ms: number): Promise<void>
}

export type TeamServiceErrorCode = 'not_found' | 'forbidden' | 'budget' | 'invalid' | 'spawn_failed'

export class TeamServiceError extends Error {
    readonly code: TeamServiceErrorCode

    constructor(code: TeamServiceErrorCode, message: string) {
        super(message)
        this.name = 'TeamServiceError'
        this.code = code
    }
}

export interface TeamStatus {
    team: TeamRecord
    me: TeamMemberRecord
    members: TeamMemberRecord[]
    tasks: TeamTaskRecord[]
    pendingTasks: TeamTaskRecord[]
    budget: TeamBudget
}

export interface TeamBudget {
    maxMembers: number
    maxMessagesPerMinute: number
    maxChainDepth: number
}

const DEFAULT_BUDGET: TeamBudget = {
    maxMembers: 8,
    maxMessagesPerMinute: 30,
    maxChainDepth: 8
}

const ACTIVATION_POLL_MS = 1000
const HUMAN_PING_TURN_GRACE_MS = 20_000
const ACTIVATION_POLL_ATTEMPTS = 30
const DEFAULT_AGENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * P1 service: team membership, peer messaging with budget guards, and member
 * spawning. All writes go through the hub; agents never write teams.db
 * directly.
 */
export class TeamService {
    private readonly store: TeamStore
    private readonly publish: (event: SyncEvent) => void
    private readonly runtime: TeamRuntime | null
    private readonly messageLog = new Map<string, number[]>()
    /** Sessions already announced as down, keyed `${teamId}:${sessionId}`. */
    private readonly downNotified = new Set<string>()
    /**
     * Human->member pings awaiting a reply, keyed by member session id. When the
     * member finishes its turn, its reply text is bridged into the team log so
     * the group chat mirrors the human<->member conversation.
     */
    private readonly pendingHumanPings = new Map<string, { teamId: string; at: number; sawThinking: boolean }>()

    constructor(
        store: TeamStore,
        publish: (event: SyncEvent) => void = () => {},
        runtime: TeamRuntime | null = null
    ) {
        this.store = store
        this.publish = publish
        this.runtime = runtime
        // Restore unanswered human pings so a hub restart does not lose the
        // reply bridge for members that were pinged before the restart.
        for (const ping of this.store.listPendingPings()) {
            this.pendingHumanPings.set(ping.sessionId, {
                teamId: ping.teamId,
                at: ping.at,
                sawThinking: ping.sawThinking
            })
        }
    }

    private armHumanPing(sessionId: string, teamId: string): void {
        const ping = { teamId, at: Date.now(), sawThinking: false }
        this.pendingHumanPings.set(sessionId, ping)
        this.store.setPendingPing({ sessionId, ...ping })
    }

    private clearHumanPing(sessionId: string): void {
        this.pendingHumanPings.delete(sessionId)
        this.store.deletePendingPing(sessionId)
    }

    // ------------------------------------------------------------ team basics

    listTeams(namespace: string): TeamRecord[] {
        return this.store.listTeams(namespace)
    }

    /** Teams with their members, for the sidebar grouping. */
    listTeamsWithMembers(namespace: string): Array<TeamRecord & { members: TeamMemberRecord[] }> {
        return this.store.listTeams(namespace).map((team) => ({
            ...team,
            members: this.store.listMembers(team.id)
        }))
    }

    getTeamDetail(teamId: string, namespace: string): TeamDetail | null {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) return null
        return {
            team,
            members: this.store.listMembers(team.id),
            tasks: this.store.listTasks(team.id)
        }
    }

    createTeam(namespace: string, input: CreateTeamServiceInput): TeamRecord {
        const storeInput: CreateTeamInput = {
            namespace,
            name: input.name,
            leadSessionId: input.leadSessionId ?? null,
            config: input.config ?? null
        }
        const team = this.store.createTeam(storeInput)
        if (input.leadSessionId) {
            this.store.addMember(team.id, input.leadSessionId, 'lead')
        }
        this.publishUpdate(team)
        // Tell the lead what it is - a lead session spawned through the normal
        // spawn path has no HAPI_TEAM_* env, so the brief is its team context.
        if (input.leadSessionId) {
            void this.deliverLeadBrief(team, input.leadSessionId).catch(() => {})
        }
        return team
    }

    resolveMembership(sessionId: string, namespace: string): { team: TeamRecord; member: TeamMemberRecord } | null {
        return this.store.findTeamBySession(sessionId, namespace)
    }

    getStatusForSession(sessionId: string, namespace: string): TeamStatus {
        const membership = this.requireMembership(sessionId, namespace)
        const tasks = this.store.listTasks(membership.team.id)
        const members = this.store.listMembers(membership.team.id).map((member) => this.deriveMemberStatus(member))
        return {
            team: membership.team,
            me: this.deriveMemberStatus(membership.member),
            members,
            tasks,
            pendingTasks: tasks.filter((task) =>
                task.assigneeSessionId === sessionId && (task.status === 'todo' || task.status === 'doing')
            ),
            budget: readBudget(membership.team.config)
        }
    }

    listMessages(
        sessionId: string,
        namespace: string,
        options: { afterSeq?: number; limit?: number } = {}
    ): TeamMessageRecord[] {
        const membership = this.requireMembership(sessionId, namespace)
        return this.store.listMessages(membership.team.id, options)
    }

    /** Human (web app) read path: namespace-authorized, no membership required. */
    listMessagesForHuman(
        namespace: string,
        teamId: string,
        options: { afterSeq?: number; limit?: number } = {}
    ): TeamMessageRecord[] {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        return this.store.listMessages(team.id, options)
    }

    // -------------------------------------------------------------- messaging

    async sendMessage(
        sessionId: string,
        namespace: string,
        input: { text: string; to?: string; kind?: string; inReplyTo?: number }
    ): Promise<TeamMessageRecord> {
        const membership = this.requireMembership(sessionId, namespace)
        const { team, member } = membership
        if (team.status !== 'active') {
            throw new TeamServiceError('forbidden', 'Team is archived')
        }
        const members = this.store.listMembers(team.id)
        const target = resolveTarget(team, members, input.to, { allowHuman: true })
        if (target.toSessionId === sessionId) {
            throw new TeamServiceError('invalid', 'Cannot send a team message to yourself')
        }
        return await this.appendAndRoute(team, target, {
            fromKind: 'session',
            fromSessionId: sessionId,
            fromRole: member.role,
            text: input.text,
            kind: input.kind,
            inReplyTo: input.inReplyTo
        })
    }

    /** Human (web app) posting into the team channel. */
    async sendHumanMessage(
        namespace: string,
        teamId: string,
        input: { text: string; to?: string; kind?: string; inReplyTo?: number }
    ): Promise<TeamMessageRecord> {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        if (team.status !== 'active') {
            throw new TeamServiceError('forbidden', 'Team is archived')
        }
        const members = this.store.listMembers(team.id)
        const target = resolveTarget(team, members, input.to, { allowHuman: false })
        return await this.appendAndRoute(team, target, {
            fromKind: 'human',
            fromSessionId: null,
            fromRole: '人类',
            text: input.text,
            kind: input.kind,
            inReplyTo: input.inReplyTo
        })
    }

    /**
     * Human answered / waved off a member's decision from the group chat: mark
     * the original message so the "待你确认" inbox stops showing it.
     */
    dismissHumanMessage(namespace: string, teamId: string, seq: number): TeamMessageRecord {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        const message = this.store.getMessage(teamId, seq)
        if (!message) {
            throw new TeamServiceError('not_found', 'Message not found')
        }
        if (message.fromKind !== 'session' || (message.kind !== 'decision' && message.meta?.awaitingHuman !== true)) {
            throw new TeamServiceError('invalid', 'Only human-facing decisions can be dismissed')
        }
        const updated = this.store.updateMessageMeta(teamId, seq, { humanDismissedAt: Date.now() })
        this.publishUpdate(team)
        return updated ?? message
    }

    private async appendAndRoute(
        team: TeamRecord,
        target: { toKind: 'broadcast' | 'mention' | 'dm'; toSessionId: string | null; toHuman?: boolean },
        input: {
            fromKind: 'session' | 'human' | 'hub'
            fromSessionId: string | null
            fromRole: string
            text: string
            kind?: string
            inReplyTo?: number
        }
    ): Promise<TeamMessageRecord> {
        if (input.fromKind === 'session' && input.fromSessionId) {
            // The member answered through the team channel itself; no bridge needed.
            this.clearHumanPing(input.fromSessionId)
        }
        const budget = readBudget(team.config)
        this.enforceMessageRate(team.id, budget)
        const replyDepth = this.resolveReplyDepth(team.id, input.inReplyTo, budget)
        const kind = input.kind ?? 'chat'
        // Decisions / explicit `to: human` asks are the messages that need a
        // human answer; flag them so the web can show a "待你确认" inbox.
        const awaitingHuman = input.fromKind === 'session'
            && (target.toHuman === true || kind === 'decision')

        const message = this.store.appendMessage({
            teamId: team.id,
            fromKind: input.fromKind,
            fromSessionId: input.fromSessionId,
            toKind: target.toKind,
            toSessionId: target.toSessionId,
            kind,
            text: input.text,
            meta: {
                fromRole: input.fromRole,
                ...(target.toHuman ? { toHuman: true } : {}),
                ...(awaitingHuman ? { awaitingHuman: true } : {}),
                ...(replyDepth > 0 ? { replyDepth } : {}),
                ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {})
            }
        })
        this.publishUpdate(team)

        // A human message that answers a decision clears that decision's inbox
        // entry (the member still receives it like any other directed message).
        if (input.fromKind === 'human' && input.inReplyTo) {
            const original = this.store.getMessage(team.id, input.inReplyTo)
            if (
                original
                && original.fromKind === 'session'
                && (original.kind === 'decision' || original.meta?.awaitingHuman === true)
            ) {
                this.store.updateMessageMeta(team.id, original.seq, {
                    humanRepliedAt: Date.now(),
                    humanReplySeq: message.seq
                })
            }
        }

        // Human-facing escalation: an explicit `to: human` or a decision from a
        // member notifies the human out-of-band (push / in-app toast).
        if (input.fromKind === 'session' && (target.toHuman || message.kind === 'decision')) {
            this.publish({
                type: 'team-attention',
                teamId: team.id,
                namespace: team.namespace,
                data: {
                    teamName: team.name,
                    seq: message.seq,
                    kind: message.kind,
                    fromRole: input.fromRole,
                    text: input.text
                }
            })
        }

        // Push only for directed messages; broadcasts stay pull-only so they
        // never fan out into every member's context.
        if (target.toSessionId && this.runtime) {
            if (input.fromKind === 'human') {
                this.armHumanPing(target.toSessionId, team.id)
            }
            const members = this.store.listMembers(team.id)
            const text = this.formatPeerText(team, members, {
                fromKind: input.fromKind,
                fromSessionId: input.fromSessionId,
                fromRole: input.fromRole,
                text: input.fromKind === 'human'
                    ? `${input.text}\n\n（人类在团队群里对你说话：直接回复本条消息即可，回复会自动同步到群聊；不要为此执行 shell 命令或查询团队成员。）`
                    : input.text
            })
            try {
                await this.runtime.deliverPeerMessage({ sessionId: target.toSessionId, text })
            } catch {
                // Delivery is best-effort; the message is already in the log and
                // the target can pick it up via team_read.
            }
        }
        return message
    }

    /**
     * Create a task from the web app. Assigning pushes the brief to the
     * assignee so it can start working without waiting for a poll.
     */
    private assertDependenciesInTeam(teamId: string, taskId: string | null, dependsOn: string[] | undefined): void {
        if (!dependsOn || dependsOn.length === 0) {
            return
        }
        for (const id of dependsOn) {
            if (taskId && id === taskId) {
                throw new TeamServiceError('invalid', '任务不能依赖自己')
            }
            const task = this.store.getTask(id)
            if (!task || task.teamId !== teamId) {
                throw new TeamServiceError('invalid', `依赖任务不存在：${id}`)
            }
        }
    }

    async createTaskForHuman(
        namespace: string,
        teamId: string,
        input: { title: string; assigneeSessionId?: string | null; dependsOn?: string[] }
    ): Promise<TeamTaskRecord> {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        const members = this.store.listMembers(team.id)
        const assigneeSessionId = input.assigneeSessionId ?? null
        if (assigneeSessionId && !members.some((member) => member.sessionId === assigneeSessionId)) {
            throw new TeamServiceError('invalid', 'Assignee is not a team member')
        }
        this.assertDependenciesInTeam(team.id, null, input.dependsOn)

        const task = this.store.createTask({
            teamId: team.id,
            title: input.title,
            assigneeSessionId,
            status: 'todo',
            ...(input.dependsOn && input.dependsOn.length > 0 ? { meta: { dependsOn: input.dependsOn } } : {})
        })
        const assigneeRole = members.find((member) => member.sessionId === assigneeSessionId)?.role
        this.store.appendMessage({
            teamId: team.id,
            fromKind: 'human',
            fromSessionId: null,
            toKind: assigneeSessionId ? 'task' : 'broadcast',
            toSessionId: assigneeSessionId,
            kind: 'task-assign',
            text: input.title,
            meta: { taskId: task.id, fromRole: '人类', ...(assigneeRole ? { role: assigneeRole } : {}) }
        })
        this.publishUpdate(team)

        if (assigneeSessionId && this.runtime) {
            try {
                await this.runtime.deliverPeerMessage({
                    sessionId: assigneeSessionId,
                    text: this.formatPeerText(team, members, {
                        fromKind: 'human',
                        fromSessionId: null,
                        fromRole: '人类',
                        text: `你有一个新任务：${input.title}\n任务 id：${task.id}`
                    })
                })
            } catch {
                // Best-effort; the task board still shows it.
            }
        }
        return task
    }

    /**
     * Adopt an existing session as a team member (web flow: the full New
     * Session form spawns the session, then joins it here). Mirrors
     * spawnMember's bookkeeping: budget/role checks, task + assignment.
     */
    async addMemberFromSession(
        namespace: string,
        teamId: string,
        input: { sessionId: string; role: string; task?: string }
    ): Promise<{ teamId: string; sessionId: string; role: string; taskId: string | null }> {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        if (team.status !== 'active') {
            throw new TeamServiceError('forbidden', 'Team is archived')
        }
        const members = this.store.listMembers(team.id)
        const budget = readBudget(team.config)
        if (members.length >= budget.maxMembers) {
            throw new TeamServiceError('budget', `Member limit reached (${budget.maxMembers})`)
        }
        if (members.some((member) => member.role === input.role)) {
            throw new TeamServiceError('invalid', `Role "${input.role}" already exists in this team`)
        }
        if (this.runtime && !this.runtime.resolveSession(input.sessionId)) {
            throw new TeamServiceError('invalid', 'Session not found on this hub')
        }

        this.store.addMember(team.id, input.sessionId, input.role, 'working')

        let taskId: string | null = null
        if (input.task) {
            const task = this.store.createTask({
                teamId: team.id,
                title: taskTitle(input.task),
                assigneeSessionId: input.sessionId,
                status: 'todo',
                meta: { brief: input.task }
            })
            taskId = task.id
        }
        this.store.appendMessage({
            teamId: team.id,
            fromKind: 'hub',
            toKind: 'task',
            toSessionId: input.sessionId,
            kind: 'task-assign',
            text: input.task ?? `新成员加入：${input.role}`,
            meta: { role: input.role, sessionId: input.sessionId, ...(taskId ? { taskId } : {}) }
        })
        this.publishUpdate(team)

        if (input.task) {
            void this.deliverAssignment(team, input.sessionId, input.role, input.task, taskId)
        }
        return { teamId: team.id, sessionId: input.sessionId, role: input.role, taskId }
    }

    /**
     * Update a task. `sessionId` present = member/CLI caller (membership
     * checked); absent = human web caller (namespace checked).
     */
    async updateTask(
        sessionId: string | null,
        namespace: string,
        taskId: string,
        patch: { status?: TeamTaskStatus; assigneeSessionId?: string | null; deliverable?: string; dependsOn?: string[] }
    ): Promise<TeamTaskRecord> {
        const membership = sessionId
            ? this.requireMembership(sessionId, namespace)
            : null
        const task = this.store.getTask(taskId)
        const team = membership?.team ?? (task ? this.store.getTeam(task.teamId, namespace) : null)
        if (!task || !team || task.teamId !== team.id) {
            throw new TeamServiceError('not_found', 'Task not found in this team')
        }

        const members = this.store.listMembers(team.id)
        if (patch.assigneeSessionId !== undefined && patch.assigneeSessionId !== null
            && !members.some((member) => member.sessionId === patch.assigneeSessionId)) {
            throw new TeamServiceError('invalid', 'Assignee is not a team member')
        }

        const meta: Record<string, unknown> = { ...(task.meta ?? {}) }
        if (patch.deliverable !== undefined) meta.deliverable = patch.deliverable
        if (patch.dependsOn !== undefined) meta.dependsOn = patch.dependsOn
        this.assertDependenciesInTeam(team.id, taskId, patch.dependsOn)
        const deliverable = typeof meta.deliverable === 'string' ? meta.deliverable.trim() : ''

        // Members must attach evidence before marking a task done; humans may
        // close tasks freely (they own the outcome).
        if (sessionId && patch.status === 'done' && !deliverable) {
            throw new TeamServiceError('invalid', '完成任务需要提供交付物（deliverable）：分支/文件/测试结果等')
        }
        // Dependencies gate member progress (todo -> doing -> done).
        if (sessionId && (patch.status === 'doing' || patch.status === 'done')) {
            const dependsOn = Array.isArray(meta.dependsOn) ? meta.dependsOn as string[] : []
            const blockers = dependsOn
                .map((id) => this.store.getTask(id))
                .filter((candidate): candidate is TeamTaskRecord =>
                    candidate !== null && candidate.teamId === team.id && candidate.status !== 'done')
            if (blockers.length > 0) {
                throw new TeamServiceError('invalid', `依赖未完成：${blockers.map((t) => `${t.title}(${t.status})`).join('、')}`)
            }
        }

        const updated = this.store.updateTask(taskId, {
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.assigneeSessionId !== undefined ? { assigneeSessionId: patch.assigneeSessionId } : {}),
            ...(patch.deliverable !== undefined || patch.dependsOn !== undefined ? { meta } : {})
        })
        if (!updated) {
            throw new TeamServiceError('not_found', 'Task not found in this team')
        }

        const fromRole = membership?.member.role ?? '人类'
        const changes: string[] = []
        if (patch.status !== undefined) changes.push(`→ ${patch.status}`)
        if (patch.assigneeSessionId !== undefined) {
            const assigneeRole = members.find((member) => member.sessionId === patch.assigneeSessionId)?.role
            changes.push(`负责人 → ${assigneeRole ?? '未指派'}`)
        }
        if (patch.deliverable !== undefined) changes.push('附交付物')
        if (patch.dependsOn !== undefined) changes.push(`依赖 ${patch.dependsOn.length} 项`)
        this.store.appendMessage({
            teamId: team.id,
            fromKind: membership ? 'session' : 'human',
            fromSessionId: sessionId,
            toKind: 'broadcast',
            kind: 'task-update',
            text: `任务「${updated.title}」${changes.join('，')}（${fromRole}）${deliverable ? `｜交付物：${deliverable.slice(0, 200)}` : ''}`,
            meta: { taskId: updated.id, fromRole, ...(deliverable ? { deliverable } : {}) }
        })
        this.publishUpdate(team)

        // Done/blocked are lead-relevant: push those to the lead explicitly.
        if (membership && patch.status !== undefined
            && (patch.status === 'done' || patch.status === 'blocked')
            && team.leadSessionId && team.leadSessionId !== sessionId && this.runtime) {
            const text = this.formatPeerText(team, members, {
                fromKind: 'session',
                fromSessionId: sessionId,
                fromRole,
                text: `任务「${updated.title}」→ ${patch.status}`
            })
            try {
                await this.runtime.deliverPeerMessage({ sessionId: team.leadSessionId, text })
            } catch {
            }
        }
        return updated
    }

    /** Rename / archive / set-lead from the web app. */
    updateTeamMeta(
        namespace: string,
        teamId: string,
        patch: {
            name?: string
            status?: 'active' | 'archived'
            leadSessionId?: string | null
            budget?: { maxMembers?: number; maxMessagesPerMinute?: number; maxChainDepth?: number }
        }
    ): TeamRecord {
        const current = this.store.getTeam(teamId, namespace)
        if (!current) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        if (patch.leadSessionId) {
            const view = this.runtime?.resolveSession(patch.leadSessionId)
            if (this.runtime && !view) {
                throw new TeamServiceError('invalid', 'Lead session not found on this hub')
            }
        }
        // Merge the budget patch into the existing config so unrelated keys survive.
        const existingBudget = current.config?.budget
        const config = patch.budget
            ? {
                ...(current.config ?? {}),
                budget: {
                    ...(existingBudget && typeof existingBudget === 'object' && !Array.isArray(existingBudget)
                        ? existingBudget as Record<string, unknown>
                        : {}),
                    ...patch.budget
                }
            }
            : undefined
        const updated = this.store.updateTeam(teamId, namespace, {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.leadSessionId !== undefined ? { leadSessionId: patch.leadSessionId } : {}),
            ...(config !== undefined ? { config } : {})
        })
        if (!updated) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        if (patch.leadSessionId) {
            this.store.addMember(teamId, patch.leadSessionId, 'lead')
            void this.deliverLeadBrief(updated, patch.leadSessionId).catch(() => {})
        }
        this.publishUpdate(updated)
        return updated
    }

    /**
     * Remove a member (human action). The member's session survives unless
     * `stopSession` is set; the lead cannot be removed (change the lead first).
     */
    async removeMember(
        namespace: string,
        teamId: string,
        sessionId: string,
        options: { stopSession?: boolean } = {}
    ): Promise<void> {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        if (team.leadSessionId === sessionId) {
            throw new TeamServiceError('invalid', '不能移除 Lead：请先在设置里把 Lead 换成其他人')
        }
        const member = this.store.listMembers(team.id).find((candidate) => candidate.sessionId === sessionId)
        if (!member) {
            throw new TeamServiceError('not_found', '该会话不是团队成员')
        }
        if (!this.store.removeMember(team.id, sessionId)) {
            throw new TeamServiceError('not_found', '该会话不是团队成员')
        }
        this.store.appendMessage({
            teamId: team.id,
            fromKind: 'hub',
            toKind: 'broadcast',
            kind: 'system',
            text: `「${member.role}」已被移出团队（人类操作）`,
            meta: { removedSessionId: sessionId, removedRole: member.role }
        })
        this.publishUpdate(team)
        if (this.runtime) {
            void this.runtime.deliverPeerMessage({
                sessionId,
                text: `你已被移出团队「${team.name}」。${options.stopSession ? '该会话即将停止。' : '该会话仍可单独继续使用。'}`
            }).catch(() => {})
            if (options.stopSession) {
                void this.runtime.archiveSession?.(sessionId).catch(() => {})
            }
        }
    }

    /** Delete a team (members/tasks/messages cascade). Member sessions survive. */
    deleteTeam(namespace: string, teamId: string): void {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        this.store.deleteTeam(teamId, namespace)
        this.publish({ type: 'team-updated', teamId, namespace })
    }

    // ----------------------------------------------------------- agent tokens

    /**
     * Team-scoped credentials for agents that want to call the hub API
     * directly. They can only reach this team's messages/tasks/status, so a
     * leaked token cannot touch machines or other sessions.
     */
    issueAgentToken(
        namespace: string,
        teamId: string,
        options: { label?: string; ttlMs?: number } = {}
    ): { token: string; teamId: string; expiresAt: number } {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        const now = Date.now()
        this.store.deleteExpiredAgentTokens(now)
        const token = `hapi_team_${randomBytes(24).toString('base64url')}`
        const expiresAt = now + (options.ttlMs ?? DEFAULT_AGENT_TOKEN_TTL_MS)
        this.store.insertAgentToken({
            token,
            teamId: team.id,
            namespace: team.namespace,
            label: options.label ?? null,
            createdAt: now,
            expiresAt
        })
        return { token, teamId: team.id, expiresAt }
    }

    /** Reuse a live token for the team at spawn time, minting one when needed. */
    getOrCreateAgentToken(namespace: string, teamId: string): string | null {
        const existing = this.store.latestAgentToken(teamId, Date.now())
        if (existing) {
            return existing.token
        }
        try {
            return this.issueAgentToken(namespace, teamId).token
        } catch {
            return null
        }
    }

    /** Resolve a raw team token to its scope (web auth middleware). */
    resolveAgentToken(token: string): { teamId: string; namespace: string } | null {
        if (!token.startsWith('hapi_team_')) {
            return null
        }
        const record = this.store.findAgentToken(token)
        if (!record || record.expiresAt <= Date.now()) {
            return null
        }
        return { teamId: record.teamId, namespace: record.namespace }
    }

    // ---------------------------------------------------------------- spawning

    async spawnMember(
        sessionId: string,
        namespace: string,
        input: {
            role: string
            task?: string
            agent?: AgentFlavor
            model?: string
            modelReasoningEffort?: string
            effort?: string
            permissionMode?: PermissionMode
            sessionType?: 'simple' | 'worktree'
            worktreeName?: string
            yolo?: boolean
        }
    ): Promise<{
        teamId: string
        sessionId: string
        role: string
        taskId: string | null
    }> {
        const membership = this.requireMembership(sessionId, namespace)
        const { team } = membership
        if (!this.runtime) {
            throw new TeamServiceError('spawn_failed', 'Team runtime is not available on this hub')
        }
        if (team.status !== 'active') {
            throw new TeamServiceError('forbidden', 'Team is archived')
        }

        const members = this.store.listMembers(team.id)
        const budget = readBudget(team.config)
        if (members.length >= budget.maxMembers) {
            throw new TeamServiceError('budget', `Member limit reached (${budget.maxMembers})`)
        }
        if (members.some((member) => member.role === input.role)) {
            throw new TeamServiceError('invalid', `Role "${input.role}" already exists in this team`)
        }

        const caller = this.runtime.resolveSession(sessionId)
        if (!caller?.machineId || !caller.directory) {
            throw new TeamServiceError('spawn_failed', 'Cannot resolve the calling session machine/directory')
        }

        const sessionType = input.sessionType ?? (caller.inWorktree ? 'worktree' : 'simple')
        const worktreeName = sessionType === 'worktree'
            ? (input.worktreeName ?? defaultWorktreeName(team, input.role))
            : undefined

        // Members inherit the caller's runtime config (tool/model/thinking
        // level/permission) unless the caller explicitly overrides it. This
        // keeps a team homogeneous without asking the lead to re-specify it.
        const permissionMode = input.permissionMode ?? caller.permissionMode ?? undefined
        const spawned = await this.runtime.spawnMember({
            machineId: caller.machineId,
            directory: caller.directory,
            agent: input.agent ?? caller.flavor ?? 'claude',
            model: input.model ?? caller.model ?? undefined,
            modelReasoningEffort: input.modelReasoningEffort ?? caller.modelReasoningEffort ?? undefined,
            effort: input.effort ?? caller.effort ?? undefined,
            permissionMode,
            sessionType,
            worktreeName,
            yolo: input.yolo === true || permissionMode === 'yolo',
            teamId: team.id,
            teamName: team.name,
            teamRole: input.role,
            teamNamespace: team.namespace
        })
        if (!spawned.ok) {
            throw new TeamServiceError('spawn_failed', spawned.message)
        }

        const newSessionId = spawned.sessionId
        this.store.addMember(team.id, newSessionId, input.role, 'working')

        let taskId: string | null = null
        if (input.task) {
            const task = this.store.createTask({
                teamId: team.id,
                title: taskTitle(input.task),
                assigneeSessionId: newSessionId,
                status: 'todo',
                meta: { brief: input.task }
            })
            taskId = task.id
        }

        this.store.appendMessage({
            teamId: team.id,
            fromKind: 'hub',
            toKind: 'task',
            toSessionId: newSessionId,
            kind: 'task-assign',
            text: input.task ?? `新成员加入：${input.role}`,
            meta: { role: input.role, sessionId: newSessionId, ...(taskId ? { taskId } : {}) }
        })
        this.publishUpdate(team)

        if (input.task) {
            const task = taskId ? this.store.getTask(taskId) : null
            void this.deliverAssignment(team, newSessionId, input.role, input.task, task?.id ?? null)
        }
        return { teamId: team.id, sessionId: newSessionId, role: input.role, taskId }
    }

    /**
     * Called on member session activity changes. When a member that received a
     * human ping finishes its turn, its last assistant text is mirrored into the
     * team log (broadcast), so the group chat shows the reply without requiring
     * the agent to call team_send.
     */
    async handleMemberActivity(sessionId: string, namespace: string, thinking: boolean): Promise<void> {
        const pending = this.pendingHumanPings.get(sessionId)
        if (!pending) return
        if (thinking) {
            pending.sawThinking = true
            this.store.markPendingPingThinking(sessionId)
            return
        }
        // Give the member a moment to actually start the turn before treating a
        // quiet session as "finished replying".
        if (!pending.sawThinking && Date.now() - pending.at < HUMAN_PING_TURN_GRACE_MS) {
            return
        }
        const membership = this.store.findTeamBySession(sessionId, namespace)
        this.clearHumanPing(sessionId)
        if (!membership || membership.team.id !== pending.teamId || membership.team.status !== 'active') {
            return
        }
        const raw = this.runtime?.lastAssistantText(sessionId) ?? null
        const text = raw?.trim()
        if (!text) return
        this.store.appendMessage({
            teamId: membership.team.id,
            fromKind: 'session',
            fromSessionId: sessionId,
            toKind: 'broadcast',
            kind: 'chat',
            text: text.length > 4000 ? `${text.slice(0, 3997)}...` : text,
            meta: { bridged: true, fromRole: membership.member.role }
        })
        this.publishUpdate(membership.team)
    }

    private async deliverLeadBrief(team: TeamRecord, leadSessionId: string): Promise<void> {
        const runtime = this.runtime
        if (!runtime) return
        try {
            let view = runtime.resolveSession(leadSessionId)
            for (let attempt = 0; attempt < ACTIVATION_POLL_ATTEMPTS && !view?.active; attempt++) {
                await runtime.sleep(ACTIVATION_POLL_MS)
                view = runtime.resolveSession(leadSessionId)
            }
            if (!view?.active) {
                this.store.appendMessage({
                    teamId: team.id,
                    fromKind: 'hub',
                    toKind: 'broadcast',
                    kind: 'system',
                    text: 'Lead 会话尚未就绪，团队工具会在其启动后可用'
                })
                this.publishUpdate(team)
                return
            }
            const members = this.store.listMembers(team.id)
            const text = this.formatPeerText(team, members, {
                fromKind: 'hub',
                fromSessionId: null,
                fromRole: 'hub',
                text: buildLeadBrief(team)
            })
            await runtime.deliverPeerMessage({ sessionId: leadSessionId, text })
        } catch {
            // Best-effort; the human can still brief the lead in the group chat.
        }
    }

    private async deliverAssignment(
        team: TeamRecord,
        targetSessionId: string,
        role: string,
        taskBrief: string,
        taskId: string | null
    ): Promise<void> {
        const runtime = this.runtime
        if (!runtime) return
        try {
            let view = runtime.resolveSession(targetSessionId)
            for (let attempt = 0; attempt < ACTIVATION_POLL_ATTEMPTS && !view?.active; attempt++) {
                await runtime.sleep(ACTIVATION_POLL_MS)
                view = runtime.resolveSession(targetSessionId)
            }
            if (!view?.active) {
                this.store.appendMessage({
                    teamId: team.id,
                    fromKind: 'hub',
                    toKind: 'task',
                    toSessionId: targetSessionId,
                    kind: 'system',
                    text: `成员 ${role} 尚未就绪，任务已记录，待其启动后通过 team_status 拉取`
                })
                this.publishUpdate(team)
                return
            }
            const members = this.store.listMembers(team.id)
            const text = this.formatPeerText(team, members, {
                fromKind: team.leadSessionId ? 'session' : 'hub',
                fromSessionId: team.leadSessionId,
                fromRole: 'lead',
                text: buildAssignmentBrief(team, role, taskBrief, taskId)
            })
            await runtime.deliverPeerMessage({ sessionId: targetSessionId, text })
        } catch {
            // Best-effort; the task stays visible via team_status.
        }
    }

    /**
     * A team member's session ended (CLI exited / archived). Announce it in the
     * team log and wake the lead so work can be reassigned. When the lead
     * itself goes down (or the team has no lead), escalate to the human.
     */
    async handleSessionDown(sessionId: string, namespace: string, reason?: string): Promise<void> {
        const membership = this.store.findTeamBySession(sessionId, namespace)
        if (!membership) return
        const { team, member } = membership
        if (team.status !== 'active') return

        const key = `${team.id}:${sessionId}`
        if (this.downNotified.has(key)) return
        this.downNotified.add(key)
        if (member.status === 'offline') return
        this.store.updateMemberStatus(team.id, sessionId, 'offline')

        const reasonText = reason ? `（${reason}）` : ''
        const text = `成员 ${member.role} 已离线：会话已结束${reasonText}`
        const message = this.store.appendMessage({
            teamId: team.id,
            fromKind: 'hub',
            toKind: 'broadcast',
            kind: 'system',
            text,
            meta: { sessionId, role: member.role, reason: reason ?? null }
        })
        this.publishUpdate(team)

        if (!this.runtime) return
        if (team.leadSessionId && team.leadSessionId !== sessionId) {
            try {
                const members = this.store.listMembers(team.id)
                await this.runtime.deliverPeerMessage({
                    sessionId: team.leadSessionId,
                    text: this.formatPeerText(team, members, {
                        fromKind: 'hub',
                        fromSessionId: null,
                        fromRole: 'hub',
                        text
                    })
                })
            } catch {
                // Best-effort: the log message remains for the lead to pull.
            }
            return
        }

        // Lead is down or absent: the human needs to know.
        this.publish({
            type: 'team-attention',
            teamId: team.id,
            namespace: team.namespace,
            data: {
                teamName: team.name,
                seq: message.seq,
                kind: 'system',
                fromRole: 'hub',
                text
            }
        })
    }

    // ------------------------------------------------------------------ helpers

    private requireMembership(sessionId: string, namespace: string): { team: TeamRecord; member: TeamMemberRecord } {
        const membership = this.store.findTeamBySession(sessionId, namespace)
        if (!membership) {
            throw new TeamServiceError('not_found', 'Session is not a member of any team')
        }
        return membership
    }

    /**
     * Live member status: blocked is sticky (explicitly reported), otherwise
     * derive from the session's activity so the lead sees working/idle/offline
     * without members having to report heartbeats.
     */
    private deriveMemberStatus(member: TeamMemberRecord): TeamMemberRecord {
        if (member.status === 'blocked' || !this.runtime) {
            return member
        }
        const view = this.runtime.resolveSession(member.sessionId)
        if (!view?.active) {
            return { ...member, status: 'offline' }
        }
        return { ...member, status: view.thinking ? 'working' : 'idle' }
    }

    private enforceMessageRate(teamId: string, budget: TeamBudget): void {
        const now = Date.now()
        const windowStart = now - 60_000
        const recent = (this.messageLog.get(teamId) ?? []).filter((timestamp) => timestamp > windowStart)
        if (recent.length >= budget.maxMessagesPerMinute) {
            throw new TeamServiceError(
                'budget',
                `Team message rate limit reached (${budget.maxMessagesPerMinute}/min); summarize and batch instead`
            )
        }
        recent.push(now)
        this.messageLog.set(teamId, recent)
    }

    private resolveReplyDepth(teamId: string, inReplyTo: number | undefined, budget: TeamBudget): number {
        if (!inReplyTo) return 0
        const parent = this.store.getMessage(teamId, inReplyTo)
        const parentDepth = typeof parent?.meta?.replyDepth === 'number' ? parent.meta.replyDepth : 0
        const depth = parentDepth + 1
        if (depth > budget.maxChainDepth) {
            throw new TeamServiceError(
                'budget',
                `Conversation chain depth limit reached (${budget.maxChainDepth}); escalate to the human instead`
            )
        }
        return depth
    }

    private formatPeerText(
        team: TeamRecord,
        members: TeamMemberRecord[],
        message: {
            fromKind: 'session' | 'human' | 'hub'
            fromSessionId: string | null
            fromRole?: string
            text: string
        }
    ): string {
        const fromRole = message.fromKind === 'human'
            ? '人类'
            : message.fromKind === 'hub'
                ? 'hub'
                : message.fromRole ?? members.find((member) => member.sessionId === message.fromSessionId)?.role ?? '成员'
        const shortId = message.fromSessionId ? message.fromSessionId.slice(0, 8) : 'hub'
        return `[团队消息 · ${team.name} · 来自 ${fromRole} (${shortId})]\n${message.text}`
    }

    private publishUpdate(team: TeamRecord): void {
        this.publish({ type: 'team-updated', teamId: team.id, namespace: team.namespace })
    }

    close(): void {
        this.store.close()
    }
}

// -------------------------------------------------------------------- helpers

function resolveTarget(
    team: TeamRecord,
    members: TeamMemberRecord[],
    to: string | undefined,
    options: { allowHuman: boolean }
): { toKind: 'broadcast' | 'mention' | 'dm'; toSessionId: string | null; toHuman?: boolean } {
    if (!to || to === 'all' || to === 'broadcast') {
        return { toKind: 'broadcast', toSessionId: null }
    }
    if (to === 'human') {
        if (!options.allowHuman) {
            throw new TeamServiceError('invalid', 'Humans cannot target themselves; use "all" or a member')
        }
        return { toKind: 'mention', toSessionId: null, toHuman: true }
    }
    if (to === 'lead') {
        if (!team.leadSessionId) {
            throw new TeamServiceError('invalid', 'This team has no lead session')
        }
        return { toKind: 'mention', toSessionId: team.leadSessionId }
    }
    const exact = members.find((member) => member.sessionId === to)
    if (exact) {
        return { toKind: 'dm', toSessionId: exact.sessionId }
    }
    const matches = members.filter((member) => member.sessionId.startsWith(to))
    if (matches.length === 0) {
        throw new TeamServiceError('not_found', `No team member matches "${to}"`)
    }
    if (matches.length > 1) {
        throw new TeamServiceError('invalid', `Ambiguous member prefix "${to}" (${matches.length} matches)`)
    }
    return { toKind: 'dm', toSessionId: matches[0]!.sessionId }
}

function readBudget(config: Record<string, unknown> | null): TeamBudget {
    const raw = config?.budget
    const budget = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {}
    return {
        maxMembers: positiveInt(budget.maxMembers, DEFAULT_BUDGET.maxMembers),
        maxMessagesPerMinute: positiveInt(budget.maxMessagesPerMinute, DEFAULT_BUDGET.maxMessagesPerMinute),
        maxChainDepth: positiveInt(budget.maxChainDepth, DEFAULT_BUDGET.maxChainDepth)
    }
}

function positiveInt(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function taskTitle(brief: string): string {
    const firstLine = brief.split('\n')[0]?.trim() ?? ''
    const title = firstLine.length > 0 ? firstLine : brief.trim()
    return title.length > 120 ? `${title.slice(0, 117)}...` : title
}

function buildLeadBrief(team: TeamRecord): string {
    return [
        `你是 HAPI 团队「${team.name}」的 Lead。`,
        '',
        '职责：拆解任务、派生成员、汇总进展，必要时把决策升级给人类。',
        '可用工具：team_status（成员/任务/预算）、team_read（拉取团队消息，广播不会主动推送）、team_send（汇报/分派/通知人类）、team_task（任务列表/更新状态/交付物/依赖）、spawn_peer（派生成员，需用户批准）。',
        '派生成员默认继承你的工具/模型/思考等级/权限，不需要手动指定；只有人类明确要求不同配置时才传覆盖参数。',
        '需要直接调用 hub API 时用团队级凭证 $HAPI_TEAM_TOKEN（只能访问本团队的消息/任务/状态），不要读取 ~/.hapi/settings.json 的凭证。',
        '需要人类决策时用 team_send 的 to="human" 或 kind="decision"；人类也会在群聊里发言、加成员或调整任务。',
        '回复人类刚发来的消息会自动同步到群聊；如果这一轮由其他事件触发（成员消息/任务/定时），而你有面向人类的结论或需要拍板，必须用 team_send（to="human" 或 kind="decision"）显式发出——这类内容不会自动同步。'
    ].join('\n')
}

/**
 * First prompt a spawned member receives. Doubles as the team-rules channel
 * for flavors without system-prompt injection (ACP etc.).
 */
function buildAssignmentBrief(
    team: TeamRecord,
    role: string,
    taskBrief: string,
    taskId: string | null
): string {
    return [
        `你已被加入 HAPI 团队「${team.name}」，角色：${role}。`,
        '',
        `你的任务：${taskBrief}`,
        ...(taskId ? [`任务 id：${taskId}`] : []),
        '',
        '团队规范：',
        '- 开工前可调用 team_read 拉取团队消息（广播不会主动推送）。',
        '- 进展/完成/阻塞用 team_send 汇报（kind=status 或 task-update）。',
        '- 任务状态用 team_task 更新：开工标 doing、卡住标 blocked、完成标 done 并附交付物（分支/文件/测试结果）；有依赖的任务需依赖先完成。',
        '- 需要 hub API 时用团队级凭证 $HAPI_TEAM_TOKEN 调 $HAPI_API_URL（只能访问本团队），不要读取 ~/.hapi/settings.json。',
        '- 不要用 team_send 闲聊或找人类对话；批量汇报，避免来回对话。',
        '- 需要人类决策时，用 team_send 的 to="human" 或 kind="decision"（会直接通知人类）。',
        '- 回复人类刚发来的消息会自动同步到群聊；由其他事件（成员消息/任务/定时）触发的轮次里若有面向人类的结论或决策需求，必须用 team_send（to="human" 或 kind="decision"）显式发送——不会自动同步。'
    ].join('\n')
}

function defaultWorktreeName(team: TeamRecord, role: string): string {
    const teamSlug = slug(team.name)
    const roleSlug = slug(role)
    return teamSlug ? `${teamSlug}-${roleSlug}` : roleSlug
}

function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
}
