import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { AgentFlavor, SyncEvent } from '@hapi/protocol/types'

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
}

export interface TeamSpawnMemberInput {
    machineId: string
    directory: string
    agent: AgentFlavor
    model?: string
    sessionType: 'simple' | 'worktree'
    worktreeName?: string
    yolo?: boolean
    teamId: string
    teamName: string
    teamRole: string
}

export interface TeamRuntime {
    resolveSession(sessionId: string): TeamSessionView | null
    /** Latest assistant plain text of a session (for bridging replies). */
    lastAssistantText(sessionId: string): string | null
    spawnMember(input: TeamSpawnMemberInput): Promise<{ ok: true; sessionId: string } | { ok: false; message: string }>
    deliverPeerMessage(input: { sessionId: string; text: string }): Promise<void>
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

export interface TeamMemoryFile {
    path: string
    size: number
    updatedAt: number
}

export interface TeamMemoryFileContent {
    path: string
    content: string
    updatedAt: number
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
    maxMembers: 5,
    maxMessagesPerMinute: 30,
    maxChainDepth: 8
}

const ACTIVATION_POLL_MS = 1000
const HUMAN_PING_TURN_GRACE_MS = 20_000
const ACTIVATION_POLL_ATTEMPTS = 30

/**
 * P1 service: team membership, peer messaging with budget guards, and member
 * spawning. All writes go through the hub; agents never write teams.db
 * directly.
 */
export class TeamService {
    private readonly store: TeamStore
    private readonly publish: (event: SyncEvent) => void
    private readonly runtime: TeamRuntime | null
    private readonly memoryRoot: string | null
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
        runtime: TeamRuntime | null = null,
        options: { memoryRoot?: string } = {}
    ) {
        this.store = store
        this.publish = publish
        this.runtime = runtime
        this.memoryRoot = options.memoryRoot ?? null
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
        // Fire-and-forget: materialize the team memory dir (charter.md + handoffs/).
        void this.ensureTeamMemory(team).catch(() => {})
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
        input: { text: string; to?: string; kind?: string }
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
            kind: input.kind
        })
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
            this.pendingHumanPings.delete(input.fromSessionId)
        }
        const budget = readBudget(team.config)
        this.enforceMessageRate(team.id, budget)
        const replyDepth = this.resolveReplyDepth(team.id, input.inReplyTo, budget)

        const message = this.store.appendMessage({
            teamId: team.id,
            fromKind: input.fromKind,
            fromSessionId: input.fromSessionId,
            toKind: target.toKind,
            toSessionId: target.toSessionId,
            kind: input.kind ?? 'chat',
            text: input.text,
            meta: {
                fromRole: input.fromRole,
                ...(target.toHuman ? { toHuman: true } : {}),
                ...(replyDepth > 0 ? { replyDepth } : {}),
                ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {})
            }
        })
        this.publishUpdate(team)

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
                this.pendingHumanPings.set(target.toSessionId, {
                    teamId: team.id,
                    at: Date.now(),
                    sawThinking: false
                })
            }
            const members = this.store.listMembers(team.id)
            const text = this.formatPeerText(team, members, {
                fromKind: input.fromKind,
                fromSessionId: input.fromSessionId,
                fromRole: input.fromRole,
                text: input.fromKind === 'human'
                    ? `${input.text}\n\n（这是人类在团队群里的消息，直接回复即可，回复会自动同步到群聊。）`
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
    async createTaskForHuman(
        namespace: string,
        teamId: string,
        input: { title: string; assigneeSessionId?: string | null }
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

        const task = this.store.createTask({
            teamId: team.id,
            title: input.title,
            assigneeSessionId,
            status: 'todo'
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
     * Update a task. `sessionId` present = member/CLI caller (membership
     * checked); absent = human web caller (namespace checked).
     */
    async updateTask(
        sessionId: string | null,
        namespace: string,
        taskId: string,
        patch: { status?: TeamTaskStatus; assigneeSessionId?: string | null }
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

        const updated = this.store.updateTask(taskId, {
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.assigneeSessionId !== undefined ? { assigneeSessionId: patch.assigneeSessionId } : {})
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
        this.store.appendMessage({
            teamId: team.id,
            fromKind: membership ? 'session' : 'human',
            fromSessionId: sessionId,
            toKind: 'broadcast',
            kind: 'task-update',
            text: `任务「${updated.title}」${changes.join('，')}（${fromRole}）`,
            meta: { taskId: updated.id, fromRole }
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
        patch: { name?: string; status?: 'active' | 'archived'; leadSessionId?: string | null }
    ): TeamRecord {
        if (patch.leadSessionId) {
            const view = this.runtime?.resolveSession(patch.leadSessionId)
            if (this.runtime && !view) {
                throw new TeamServiceError('invalid', 'Lead session not found on this hub')
            }
        }
        const updated = this.store.updateTeam(teamId, namespace, patch)
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

    /** Delete a team (members/tasks/messages cascade). Member sessions survive. */
    deleteTeam(namespace: string, teamId: string): void {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        this.store.deleteTeam(teamId, namespace)
        this.publish({ type: 'team-updated', teamId, namespace })
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

        const spawned = await this.runtime.spawnMember({
            machineId: caller.machineId,
            directory: caller.directory,
            agent: input.agent ?? caller.flavor ?? 'claude',
            model: input.model,
            sessionType,
            worktreeName,
            yolo: input.yolo === true,
            teamId: team.id,
            teamName: team.name,
            teamRole: input.role
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
            return
        }
        // Give the member a moment to actually start the turn before treating a
        // quiet session as "finished replying".
        if (!pending.sawThinking && Date.now() - pending.at < HUMAN_PING_TURN_GRACE_MS) {
            return
        }
        const membership = this.store.findTeamBySession(sessionId, namespace)
        this.pendingHumanPings.delete(sessionId)
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
                text: buildLeadBrief(team, this.teamMemoryDir(team.id))
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
                text: buildAssignmentBrief(team, role, taskBrief, taskId, this.teamMemoryDir(team.id))
            })
            await runtime.deliverPeerMessage({ sessionId: targetSessionId, text })
        } catch {
            // Best-effort; the task stays visible via team_status.
        }
    }

    // ----------------------------------------------------------------- memory

    /** Absolute path of a team's memory dir, or null when memory is disabled. */
    teamMemoryDir(teamId: string): string | null {
        return this.memoryRoot ? join(this.memoryRoot, teamId) : null
    }

    private async ensureTeamMemory(team: TeamRecord): Promise<void> {
        const dir = this.teamMemoryDir(team.id)
        if (!dir) return
        await mkdir(join(dir, 'handoffs'), { recursive: true })
        const charter = join(dir, 'charter.md')
        try {
            await stat(charter)
        } catch {
            await writeFile(charter, charterTemplate(team), 'utf8')
        }
    }

    async listMemoryFiles(namespace: string, teamId: string): Promise<TeamMemoryFile[]> {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        const dir = this.teamMemoryDir(team.id)
        if (!dir) return []

        const files: TeamMemoryFile[] = []
        const walk = async (current: string, prefix: string, depth: number): Promise<void> => {
            if (depth > 3) return
            let entries
            try {
                entries = await readdir(current, { withFileTypes: true })
            } catch {
                return
            }
            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue
                const relative = prefix ? `${prefix}/${entry.name}` : entry.name
                if (entry.isDirectory()) {
                    await walk(join(current, entry.name), relative, depth + 1)
                    continue
                }
                if (!entry.isFile()) continue
                try {
                    const info = await stat(join(current, entry.name))
                    files.push({ path: relative, size: info.size, updatedAt: info.mtimeMs })
                } catch {
                }
            }
        }
        await walk(dir, '', 1)
        return files.sort((a, b) => a.path.localeCompare(b.path))
    }

    async readMemoryFile(namespace: string, teamId: string, relativePath: string): Promise<TeamMemoryFileContent> {
        const team = this.store.getTeam(teamId, namespace)
        if (!team) {
            throw new TeamServiceError('not_found', 'Team not found')
        }
        const dir = this.teamMemoryDir(team.id)
        if (!dir) {
            throw new TeamServiceError('not_found', 'File not found')
        }
        const normalized = sanitizeRelativePath(relativePath)
        const root = resolve(dir)
        const absolute = resolve(root, normalized)
        if (absolute !== root && !absolute.startsWith(root + sep)) {
            throw new TeamServiceError('invalid', 'Invalid path')
        }
        let info
        try {
            info = await stat(absolute)
        } catch {
            throw new TeamServiceError('not_found', 'File not found')
        }
        if (!info.isFile()) {
            throw new TeamServiceError('not_found', 'File not found')
        }
        if (info.size > MAX_MEMORY_FILE_BYTES) {
            throw new TeamServiceError('invalid', 'File is too large to preview')
        }
        let content: string
        try {
            content = await readFile(absolute, 'utf8')
        } catch {
            throw new TeamServiceError('invalid', 'File is not readable as text')
        }
        return { path: normalized, content, updatedAt: info.mtimeMs }
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

function buildLeadBrief(team: TeamRecord, memoryDir: string | null): string {
    return [
        `你是 HAPI 团队「${team.name}」的 Lead。`,
        '',
        '职责：拆解任务、派生成员、汇总进展，必要时把决策升级给人类。',
        '可用工具：team_status（成员/任务/预算）、team_read（拉取团队消息，广播不会主动推送）、team_send（汇报/分派/通知人类）、spawn_peer（派生成员，需用户批准）。',
        '需要人类决策时用 team_send 的 to="human" 或 kind="decision"；人类也会在群聊里发言、加成员或调整任务。',
        '你在自己会话里的正常回复会自动同步到团队群聊（人类可见），不需要用 team_send 转述。',
        ...(memoryDir ? ['', `团队记忆目录（hub 主机）：${memoryDir}/（charter.md 是团队规约，交接产物写到 handoffs/）`] : [])
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
    taskId: string | null,
    memoryDir: string | null
): string {
    return [
        `你已被加入 HAPI 团队「${team.name}」，角色：${role}。`,
        '',
        `你的任务：${taskBrief}`,
        ...(taskId ? [`任务 id：${taskId}`] : []),
        ...(memoryDir ? ['', `团队记忆目录（hub 主机）：${memoryDir}/（charter.md 是团队规约，交接产物写到 handoffs/）`] : []),
        '',
        '团队规范：',
        '- 开工前可调用 team_read 拉取团队消息（广播不会主动推送）。',
        '- 进展/完成/阻塞用 team_send 汇报（kind=status 或 task-update）；完成后用 team_status 核对任务状态。',
        '- 不要用 team_send 闲聊或找人类对话；批量汇报，避免来回对话。',
        '- 需要人类决策时，用 team_send 的 to="human" 或 kind="decision"（会直接通知人类）。',
        '- 你的普通回复会留在自己的会话里，并会自动同步到团队群聊（人类可见）。'
    ].join('\n')
}

function defaultWorktreeName(team: TeamRecord, role: string): string {
    const teamSlug = slug(team.name)
    const roleSlug = slug(role)
    return teamSlug ? `${teamSlug}-${roleSlug}` : roleSlug
}

const MAX_MEMORY_FILE_BYTES = 256 * 1024

function sanitizeRelativePath(value: string): string {
    const normalized = value.replace(/\\/g, '/').trim()
    if (!normalized || normalized.includes('\0')) {
        throw new TeamServiceError('invalid', 'Invalid path')
    }
    const segments = normalized.split('/')
    if (normalized.startsWith('/') || segments.some((segment) => segment === '' || segment === '..')) {
        throw new TeamServiceError('invalid', 'Invalid path')
    }
    return normalized
}

function charterTemplate(team: TeamRecord): string {
    return [
        `# ${team.name} — 团队规约`,
        '',
        '> 本文件由 Hub 自动生成，团队成员与人类都可编辑。',
        '',
        '## 目标',
        '（lead 或人类补充这个团队要达成什么）',
        '',
        '## 协作规则',
        '- 广播消息不会主动推送：开工前用 team_read 拉取，完成后用 team_send 汇报。',
        '- 需要人类决策时用 team_send 的 to="human" 或 kind="decision"。',
        '- 交接产物写到 handoffs/ 目录，文件名用任务 id 或简短主题。',
        '',
        '## 决策记录',
        '（重要取舍追加到这里，说明日期、背景、结论）',
        ''
    ].join('\n')
}

function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
}
