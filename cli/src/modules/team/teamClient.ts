/**
 * Agent Team client used by the CLI / MCP tools.
 *
 * Talks to the hub's /api/teams endpoints with the same JWT flow as the web
 * app (`POST /api/auth` with the CLI_API_TOKEN), scoped to the token's
 * namespace. Never accepts an arbitrary host: always the configured hub.
 */

import axios, { type AxiosInstance } from 'axios'

import { configuration } from '@/configuration'
import { getAuthToken } from '@/api/auth'
import { buildHubRequestHeaders } from '@/api/hubExtraHeaders'
import { exchangeJwt, resolveAccessToken, resolveApiUrl } from '@/modules/pingPeer/pingPeer'

export class TeamClientError extends Error {
    readonly code: 'not_in_team' | 'auth_failed' | 'request_failed'

    constructor(code: TeamClientError['code'], message: string) {
        super(message)
        this.name = 'TeamClientError'
        this.code = code
    }
}

export interface TeamClientOptions {
    sessionId: string
    apiUrl?: string
    accessToken?: string
    http?: AxiosInstance
    /** Per-request timeout; defaults to 15s. Startup probes use a shorter one. */
    timeoutMs?: number
}

export interface TeamMemberView {
    sessionId: string
    role: string
    status: string
}

export interface TeamTaskView {
    id: string
    title: string
    status: string
    assigneeSessionId: string | null
    meta?: Record<string, unknown> | null
}

export interface TeamStatusView {
    team: { id: string; name: string; status: string; leadSessionId: string | null }
    me: { sessionId: string; role: string; status: string }
    members: TeamMemberView[]
    tasks: TeamTaskView[]
    pendingTasks: TeamTaskView[]
    budget: { maxMembers: number; maxMessagesPerMinute: number; maxChainDepth: number }
}

export interface TeamMessageView {
    seq: number
    fromSessionId: string | null
    fromKind: string
    toSessionId: string | null
    kind: string
    text: string
    createdAt: number
    meta: Record<string, unknown> | null
}

interface SessionContext {
    apiUrl: string
    jwt: string
    http: AxiosInstance
    timeoutMs: number
}

async function openSession(options: TeamClientOptions): Promise<SessionContext> {
    const apiUrl = resolveApiUrl(options.apiUrl ?? configuration.apiUrl)
    const accessToken = resolveAccessToken(options.accessToken)
    const http = options.http ?? axios
    let jwt: string
    try {
        jwt = await exchangeJwt(apiUrl, accessToken, http)
    } catch (error) {
        throw new TeamClientError('auth_failed', error instanceof Error ? error.message : String(error))
    }
    return { apiUrl, jwt, http, timeoutMs: options.timeoutMs ?? 15_000 }
}

function headers(jwt: string): Record<string, string> {
    return buildHubRequestHeaders({
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json'
    })
}

async function request<T>(
    context: SessionContext,
    method: 'get' | 'post' | 'patch',
    path: string,
    body?: unknown
): Promise<T> {
    let response
    try {
        response = await context.http.request({
            method,
            url: `${context.apiUrl}${path}`,
            headers: headers(context.jwt),
            data: body,
            timeout: context.timeoutMs,
            validateStatus: () => true
        })
    } catch (error) {
        throw new TeamClientError('request_failed', error instanceof Error ? error.message : String(error))
    }
    if (response.status >= 200 && response.status < 300) {
        return response.data as T
    }
    const detail = typeof response.data?.error === 'string' ? response.data.error : 'request failed'
    throw new TeamClientError('request_failed', `HTTP ${response.status}: ${detail}`)
}

/**
 * Fetch the team status for a session. Returns null when the session is not a
 * team member (or the hub has the feature disabled / older than teams).
 */
export async function fetchTeamStatus(options: TeamClientOptions): Promise<TeamStatusView | null> {
    const context = await openSession(options)
    try {
        return await request<TeamStatusView>(
            context,
            'get',
            `/api/teams/by-session/${encodeURIComponent(options.sessionId)}`
        )
    } catch (error) {
        if (error instanceof TeamClientError && error.code === 'request_failed' && /HTTP 404/.test(error.message)) {
            return null
        }
        throw error
    }
}

/**
 * Startup probe: does this hub build have the team feature enabled?
 * 404 means disabled (or an older hub) -> the CLI must not register team
 * tools, keeping non-team behavior byte-identical. Never throws.
 */
export async function probeTeamsSupport(): Promise<boolean> {
    try {
        const context = await openSession({ sessionId: '', timeoutMs: 3000 })
        const response = await context.http.request({
            method: 'get',
            url: `${context.apiUrl}/api/teams/feature`,
            headers: headers(context.jwt),
            timeout: context.timeoutMs,
            validateStatus: () => true
        })
        return response.status >= 200 && response.status < 300
    } catch {
        return false
    }
}

/**
 * Resolve the caller's current team membership fresh from the hub. Returns
 * null when the session is not a member (callers must handle that). This is
 * what makes team tools work for sessions that joined mid-life.
 */
export async function resolveCurrentTeam(
    options: TeamClientOptions
): Promise<TeamStatusView | null> {
    try {
        return await fetchTeamStatus(options)
    } catch (error) {
        if (error instanceof TeamClientError && error.code === 'request_failed' && /HTTP 404/.test(error.message)) {
            return null
        }
        throw error
    }
}

export async function sendTeamMessage(
    options: TeamClientOptions & {
        teamId: string
        text: string
        to?: string
        kind?: string
        inReplyTo?: number
    }
): Promise<TeamMessageView> {
    const context = await openSession(options)
    const response = await request<{ message: TeamMessageView }>(
        context,
        'post',
        `/api/teams/${encodeURIComponent(options.teamId)}/messages`,
        {
            fromSessionId: options.sessionId,
            text: options.text,
            to: options.to,
            kind: options.kind,
            inReplyTo: options.inReplyTo
        }
    )
    return response.message
}

export async function readTeamMessages(
    options: TeamClientOptions & { teamId: string; afterSeq?: number; limit?: number }
): Promise<TeamMessageView[]> {
    const context = await openSession(options)
    const params = new URLSearchParams({ sessionId: options.sessionId })
    if (options.afterSeq !== undefined) params.set('afterSeq', String(options.afterSeq))
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    const response = await request<{ messages: TeamMessageView[] }>(
        context,
        'get',
        `/api/teams/${encodeURIComponent(options.teamId)}/messages?${params.toString()}`
    )
    return response.messages
}

export async function spawnTeamMember(
    options: TeamClientOptions & {
        teamId: string
        role: string
        task?: string
        agent?: string
        model?: string
        modelReasoningEffort?: string
        permissionMode?: string
        sessionType?: 'simple' | 'worktree'
        worktreeName?: string
    }
): Promise<{ teamId: string; sessionId: string; role: string; taskId: string | null }> {
    const context = await openSession(options)
    return await request(
        context,
        'post',
        `/api/teams/${encodeURIComponent(options.teamId)}/spawn`,
        {
            fromSessionId: options.sessionId,
            role: options.role,
            task: options.task,
            agent: options.agent,
            model: options.model,
            modelReasoningEffort: options.modelReasoningEffort,
            permissionMode: options.permissionMode,
            sessionType: options.sessionType,
            worktreeName: options.worktreeName
        }
    )
}

export async function updateTeamTask(
    options: TeamClientOptions & {
        teamId: string
        taskId: string
        status?: 'todo' | 'doing' | 'done' | 'blocked'
        deliverable?: string
        dependsOn?: string[]
    }
): Promise<TeamTaskView | null> {
    const context = await openSession(options)
    const response = await request<{ task: TeamTaskView }>(
        context,
        'patch',
        `/api/teams/${encodeURIComponent(options.teamId)}/tasks/${encodeURIComponent(options.taskId)}`,
        {
            fromSessionId: options.sessionId,
            ...(options.status !== undefined ? { status: options.status } : {}),
            ...(options.deliverable !== undefined ? { deliverable: options.deliverable } : {}),
            ...(options.dependsOn !== undefined ? { dependsOn: options.dependsOn } : {})
        }
    )
    return response.task ?? null
}

// -------------------------------------------------------------- formatting

export function formatTeamStatus(status: TeamStatusView): string {
    const lines: string[] = []
    lines.push(`团队：${status.team.name}（${status.team.status}） · 你的角色：${status.me.role}`)
    lines.push('')
    lines.push(`成员（${status.members.length}/${status.budget.maxMembers}）：`)
    for (const member of status.members) {
        const me = member.sessionId === status.me.sessionId ? ' ← 你' : ''
        const lead = member.sessionId === status.team.leadSessionId ? ' [lead]' : ''
        lines.push(`- ${member.role} (${member.sessionId.slice(0, 8)}) · ${member.status}${lead}${me}`)
    }
    if (status.pendingTasks.length > 0) {
        lines.push('')
        lines.push('你的待办任务：')
        for (const task of status.pendingTasks) {
            lines.push(`- ${task.title} [${task.status}] id=${task.id}${taskMetaSummary(task)}`)
        }
    } else {
        lines.push('')
        lines.push('你的待办任务：无')
    }
    lines.push('')
    lines.push(`限额：消息 ${status.budget.maxMessagesPerMinute}/分钟 · 链深 ${status.budget.maxChainDepth}`)
    return lines.join('\n')
}

/** One-line task summary: dependencies + completion evidence. */
export function taskMetaSummary(task: TeamTaskView): string {
    const meta = task.meta ?? {}
    const deps = Array.isArray(meta.dependsOn) ? (meta.dependsOn as string[]) : []
    const deliverable = typeof meta.deliverable === 'string' ? meta.deliverable.trim() : ''
    const parts: string[] = []
    if (deps.length > 0) parts.push(`依赖 ${deps.map((dep) => dep.slice(0, 8)).join(',')}`)
    if (deliverable) parts.push(`交付物 ${deliverable.slice(0, 80)}`)
    return parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
}

export function formatTeamTasks(tasks: TeamTaskView[], selfSessionId: string): string {
    if (tasks.length === 0) {
        return '（团队暂无任务）'
    }
    return tasks.map((task) => {
        const mine = task.assigneeSessionId === selfSessionId ? ' ← 你' : ''
        return `- [${task.status}] ${task.title} id=${task.id}${mine}${taskMetaSummary(task)}`
    }).join('\n')
}

export function formatTeamMessages(messages: TeamMessageView[], selfSessionId: string): string {
    if (messages.length === 0) {
        return '（没有新消息）'
    }
    return messages.map((message) => {
        const from = message.fromKind === 'hub'
            ? 'hub'
            : message.fromKind === 'human'
                ? '人类'
                : message.fromSessionId === selfSessionId
                    ? '你'
                    : message.fromSessionId?.slice(0, 8) ?? '成员'
        const to = message.toSessionId ? ` → ${message.toSessionId.slice(0, 8)}` : ' → 全员'
        const time = new Date(message.createdAt).toISOString().slice(11, 19)
        return `#${message.seq} [${time}] ${from}${to} (${message.kind}): ${message.text}`
    }).join('\n')
}
