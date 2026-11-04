import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type JsonRecord = Record<string, unknown>

export type DshSessionEvent = {
    type: string
    seq: number
    time: number
    data: unknown
    sourceEventSeqs?: number[]
    surfaceOp?: unknown
    ignorable?: true
}

export type DshHistoryEntry = {
    event: DshSessionEvent
    view?: unknown
}

export type DshSessionSummary = {
    sessionId: string
    updatedAt: number
    running: boolean
    blank: boolean
    parentSessionId?: string
    origin?: 'subagent'
    cwd?: string
    agentPreset?: string
    agentAvailable?: boolean
    projections?: {
        asOfSeq: number
        values: Record<string, unknown>
    }
}

export type DshMuxFrame = {
    type: string
    sessionId?: string
    event?: DshSessionEvent
    [key: string]: unknown
}

export type DshServerRequest = {
    type: 'server-request'
    rpcId: string
    method: string
    payload: DshMuxFrame
}

export type DshModelSelection = {
    provider: string
    model: string
    reasoningEffort?: string
}

export type DshModelSummary = {
    provider: string
    providerName: string
    model: string
    name: string
    reasoningEfforts: Array<{ id: string; name: string; isDefault: boolean }>
}

export type DshCommandResult =
    | { kind: 'success'; text?: string; sourceEventSeq?: number }
    | { kind: 'error'; text: string }

export type DshCommandExecution = {
    commandId: string
    result: DshCommandResult
}

export class DshWebRpcError extends Error {
    constructor(
        readonly method: string,
        readonly code: string,
        message: string,
        readonly details?: unknown
    ) {
        super(`DeepSeek Harness ${method} failed: ${message}`)
        this.name = 'DshWebRpcError'
    }
}

export function resolveDshWebUrl(value = process.env.HAPI_DSH_URL): string {
    const candidate = value?.trim() || 'http://127.0.0.1:3080'
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('HAPI_DSH_URL must use http:// or https://')
    }
    if (url.username || url.password || url.hash) {
        throw new Error('HAPI_DSH_URL must not contain credentials or a fragment')
    }
    if ([...url.searchParams.keys()].some((key) => key !== 'token')) {
        throw new Error('HAPI_DSH_URL only accepts the DSH launch token query parameter')
    }
    url.search = ''
    url.pathname = '/'
    return url.origin
}

/**
 * DSH 0.2.x prints a short-lived launch token in its web URL.  Keep the URL
 * parser strict, but accept the printed URL at the client boundary and strip
 * its token before constructing the base URL.
 */
function resolveConfiguredUrl(value: string | undefined): { url: string; token?: string } {
    const candidate = value?.trim() || 'http://127.0.0.1:3080'
    const parsed = new URL(candidate)
    const token = parsed.searchParams.get('token') || undefined
    if (token) parsed.search = ''
    return { url: resolveDshWebUrl(parsed.toString()), ...(token ? { token } : {}) }
}

function tokenFromFile(path: string): string | undefined {
    try {
        const text = readFileSync(path, 'utf8').trim()
        if (!text) return undefined
        try {
            const url = new URL(text)
            return url.searchParams.get('token') || undefined
        } catch {
            return text.split(/\s+/u)[0]
        }
    } catch {
        return undefined
    }
}

function configuredToken(explicit?: string, explicitFile?: string): string | undefined {
    // An explicit empty token disables file discovery.  This keeps callers
    // that inject a fetch implementation (tests and availability probes)
    // isolated from a developer's real ~/.dsh token.
    if (explicit !== undefined) return explicit.trim() || undefined
    if (explicitFile !== undefined) {
        const token = tokenFromFile(explicitFile.trim())
        return token
    }
    if (process.env.HAPI_DSH_TOKEN?.trim()) return process.env.HAPI_DSH_TOKEN.trim()
    const configuredPath = process.env.HAPI_DSH_TOKEN_FILE?.trim()
    const paths = configuredPath
        ? [configuredPath]
        : [
            join(homedir(), '.dsh', 'hapi-token'),
            join(homedir(), '.local', 'share', 'deepseek-harness', 'state', 'hapi-token')
        ]
    for (const path of paths) {
        const token = tokenFromFile(path)
        if (token) return token
    }
    return undefined
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseSessionEvent(value: unknown): DshSessionEvent | null {
    if (!isRecord(value)) return null
    const type = asString(value.type)
    const seq = asNumber(value.seq)
    const time = asNumber(value.time)
    if (!type || seq === null || time === null || seq < 0) return null
    return {
        type,
        seq,
        time,
        data: value.data,
        ...(Array.isArray(value.sourceEventSeqs)
            ? { sourceEventSeqs: value.sourceEventSeqs.filter((entry): entry is number => typeof entry === 'number') }
            : {}),
        ...(value.surfaceOp !== undefined ? { surfaceOp: value.surfaceOp } : {}),
        ...(value.ignorable === true ? { ignorable: true } : {})
    }
}

function parseSessionSummary(value: unknown): DshSessionSummary | null {
    if (!isRecord(value)) return null
    const sessionId = asString(value.sessionId)
    const updatedAt = asNumber(value.updatedAt)
    if (!sessionId || updatedAt === null || typeof value.running !== 'boolean' || typeof value.blank !== 'boolean') {
        return null
    }
    const projections = isRecord(value.projections)
        && asNumber(value.projections.asOfSeq) !== null
        && isRecord(value.projections.values)
        ? {
            asOfSeq: value.projections.asOfSeq as number,
            values: value.projections.values
        }
        : undefined
    return {
        sessionId,
        updatedAt,
        running: value.running,
        blank: value.blank,
        ...(asString(value.parentSessionId) ? { parentSessionId: value.parentSessionId as string } : {}),
        ...(value.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
        ...(asString(value.cwd) ? { cwd: value.cwd as string } : {}),
        ...(asString(value.agentPreset) ? { agentPreset: value.agentPreset as string } : {}),
        ...(typeof value.agentAvailable === 'boolean' ? { agentAvailable: value.agentAvailable } : {}),
        ...(projections ? { projections } : {})
    }
}

export class DshWebClient {
    readonly baseUrl: string
    private readonly launchToken?: string
    private authCookie?: string
    private remoteEventCookie?: string
    private authMode: 'unknown' | 'legacy' | 'remote' = 'unknown'
    private remoteClientId?: string

    constructor(
        baseUrl = process.env.HAPI_DSH_URL ?? 'http://127.0.0.1:3080',
        private readonly fetchImpl: typeof fetch = fetch,
        token?: string,
        tokenFile?: string
    ) {
        const configured = resolveConfiguredUrl(baseUrl)
        this.baseUrl = configured.url
        this.launchToken = configured.token ?? configuredToken(token, tokenFile)
    }

    async describe(signal?: AbortSignal): Promise<{
        version: string
        cwd: string
        provider: string
        model: string
        attachedSessions: number
    }> {
        await this.ensureAuth(signal)
        if (this.authMode === 'remote') {
            const sessions = await this.listSessions(signal)
            const cwd = sessions.find((entry) => entry.cwd)?.cwd ?? process.cwd()
            return {
                version: '0.2.1',
                cwd,
                provider: 'unknown',
                model: 'unknown',
                attachedSessions: sessions.filter((entry) => entry.agentAvailable ?? entry.running).length
            }
        }
        const { value } = await this.call('host.describe', {}, signal)
        if (!isRecord(value)) throw new Error('DeepSeek Harness host.describe returned an invalid value')
        const version = asString(value.version)
        const cwd = asString(value.cwd)
        const provider = asString(value.provider)
        const model = asString(value.model)
        const attachedSessions = asNumber(value.attachedSessions)
        if (!version || !cwd || !provider || !model || attachedSessions === null) {
            throw new Error('DeepSeek Harness host.describe is missing required fields')
        }
        return { version, cwd, provider, model, attachedSessions }
    }

    async listSessions(signal?: AbortSignal): Promise<DshSessionSummary[]> {
        const { value } = await this.call('session.list', {}, signal)
        if (!isRecord(value) || !Array.isArray(value.items)) {
            throw new Error('DeepSeek Harness session.list returned an invalid value')
        }
        const sessions = value.items.map(parseSessionSummary)
        if (sessions.some((entry) => entry === null)) {
            throw new Error('DeepSeek Harness session.list returned an invalid session row')
        }
        return sessions as DshSessionSummary[]
    }

    async getHistory(options: {
        sessionId: string
        beforeSeq?: number
        maxMessages?: number
        signal?: AbortSignal
    }): Promise<{ entries: DshHistoryEntry[]; hasMore: boolean; projections?: { asOfSeq: number; values: Record<string, unknown> } }> {
        const payload = {
            sessionId: options.sessionId,
            ...(options.beforeSeq !== undefined ? { beforeSeq: options.beforeSeq } : {}),
            ...(options.maxMessages !== undefined ? { maxMessages: options.maxMessages } : {})
        }
        const remote = await this.ensureAuth(options.signal)
        const throughSeq = remote
            ? await this.readSessionCursor(options.sessionId, options.signal)
            : undefined
        const { value } = remote
            ? await this.call('session.page', {
                request: {
                    address: { kind: 'session', sessionId: options.sessionId },
                    // A page is inclusive. The follow opening snapshot gives
                    // us the valid current tail cursor.
                    throughSeq,
                    ...(options.beforeSeq !== undefined ? { beforeSeq: options.beforeSeq } : {}),
                    ...(options.maxMessages !== undefined ? { maxMessages: options.maxMessages } : {})
                }
            }, options.signal, 120_000)
            : await this.call('session.history', payload, options.signal, 120_000)
        const rows = isRecord(value) && Array.isArray(value.events)
            ? value.events
            : isRecord(value) && Array.isArray(value.records)
                ? value.records
                : null
        if (!isRecord(value) || !rows || typeof value.hasMore !== 'boolean') {
            throw new Error(`DeepSeek Harness ${remote ? 'session.page' : 'session.history'} returned an invalid value`)
        }
        const entries: DshHistoryEntry[] = []
        for (const raw of rows) {
            if (!isRecord(raw)) throw new Error('DeepSeek Harness session.history returned an invalid entry')
            const event = parseSessionEvent(raw.event)
            if (!event) throw new Error('DeepSeek Harness session.history returned an invalid event')
            entries.push({ event, ...(raw.view !== undefined ? { view: raw.view } : {}) })
        }
        const projections = isRecord(value.projections)
            && asNumber(value.projections.asOfSeq) !== null
            && isRecord(value.projections.values)
            ? { asOfSeq: value.projections.asOfSeq as number, values: value.projections.values }
            : undefined
        return { entries, hasMore: value.hasMore, ...(projections ? { projections } : {}) }
    }

    async createSession(options: { cwd: string; agentPreset?: string }, signal?: AbortSignal): Promise<string> {
        const { value } = await this.call('session.create', options, signal)
        if (!isRecord(value) || !asString(value.sessionId)) {
            throw new Error('DeepSeek Harness session.create returned an invalid session id')
        }
        return value.sessionId as string
    }

    async prompt(options: {
        sessionId: string
        text: string
        mode?: 'queue' | 'steer'
        clientTimeZone?: string
        rpcId?: string
        signal?: AbortSignal
    }): Promise<{ rpcId: string; command?: { text?: string } }> {
        const { rpcId, value } = await this.call('session.prompt', {
            requestId: options.rpcId ?? randomUUID(),
            sessionId: options.sessionId,
            mode: options.mode ?? 'queue',
            content: [{ type: 'text', text: options.text }],
            ...(options.clientTimeZone ? { clientTimeZone: options.clientTimeZone } : {})
        }, options.signal, 120_000, options.rpcId)
        if (!isRecord(value) || value.accepted !== true) {
            throw new Error('DeepSeek Harness session.prompt was not accepted')
        }
        const command = isRecord(value.command) && value.command.kind === 'success'
            ? { ...(typeof value.command.text === 'string' ? { text: value.command.text } : {}) }
            : undefined
        return { rpcId, ...(command ? { command } : {}) }
    }

    /**
     * Execute a native DSH slash command without creating a model turn.
     *
     * DSH returns `undefined` when the line is not a known command (or has
     * invalid command syntax); callers can then fall back to a normal prompt.
     */
    async executeCommand(
        sessionId: string,
        line: string,
        signal?: AbortSignal
    ): Promise<DshCommandExecution | undefined> {
        const { value } = await this.call('commands/execute', {
            args: {
                agentId: sessionId,
                line,
                images: []
            }
        }, signal, 300_000)
        if (value === undefined || value === null) return undefined
        if (!isRecord(value) || !asString(value.commandId) || !isRecord(value.result)) {
            throw new Error('DeepSeek Harness commands/execute returned an invalid execution')
        }
        const result = value.result
        const kind = result.kind
        if (kind === 'success') {
            const sourceEventSeq = result.sourceEventSeq
            if (sourceEventSeq !== undefined && asNumber(sourceEventSeq) === null) {
                throw new Error('DeepSeek Harness commands/execute returned an invalid source event sequence')
            }
            return {
                commandId: value.commandId as string,
                result: {
                    kind: 'success',
                    ...(typeof result.text === 'string' ? { text: result.text } : {}),
                    ...(sourceEventSeq !== undefined ? { sourceEventSeq: sourceEventSeq as number } : {})
                }
            }
        }
        if (kind === 'error' && typeof result.text === 'string') {
            return {
                commandId: value.commandId as string,
                result: { kind: 'error', text: result.text }
            }
        }
        throw new Error('DeepSeek Harness commands/execute returned an invalid command result')
    }

    async cancel(sessionId: string, signal?: AbortSignal): Promise<void> {
        const { value } = await this.call('session.cancel', { sessionId }, signal)
        if (!isRecord(value) || value.accepted !== true) {
            throw new Error('DeepSeek Harness session.cancel was not accepted')
        }
    }

    async getModels(sessionId: string, signal?: AbortSignal): Promise<{
        current: DshModelSelection
        models: DshModelSummary[]
    }> {
        const remote = await this.ensureAuth(signal)
        const { value } = remote
            ? await this.call('session.modelCatalog', {}, signal)
            : await this.call('session.models', { sessionId }, signal)
        if (!isRecord(value) || !Array.isArray(value.groups)) {
            throw new Error('DeepSeek Harness session.models returned an invalid value')
        }
        let currentValue = remote
            ? (isRecord(value.default) ? value.default : null)
            : (isRecord(value.current) ? value.current : null)
        if (remote) {
            const projections = await this.call('session/projections', {
                request: { sessionId }
            }, signal)
            const projectionValue = isRecord(projections.value) && isRecord(projections.value.values)
                ? projections.value.values
                : null
            const selection = projectionValue && isRecord(projectionValue.modelSelection)
                ? (isRecord(projectionValue.modelSelection.next)
                    ? projectionValue.modelSelection.next
                    : isRecord(projectionValue.modelSelection.lastUsed)
                        ? projectionValue.modelSelection.lastUsed
                        : null)
                : null
            if (selection) currentValue = selection
        }
        if (!currentValue) throw new Error('DeepSeek Harness session.models is missing the current model')
        const provider = asString(currentValue.provider)
        const model = asString(currentValue.model)
        if (!provider || !model) {
            throw new Error('DeepSeek Harness session.models is missing the current model')
        }

        const models: DshModelSummary[] = []
        for (const rawGroup of value.groups) {
            if (!isRecord(rawGroup) || !asString(rawGroup.id) || !asString(rawGroup.name) || !Array.isArray(rawGroup.models)) {
                throw new Error('DeepSeek Harness session.models returned an invalid provider group')
            }
            for (const rawModel of rawGroup.models) {
                if (!isRecord(rawModel) || !asString(rawModel.id) || !asString(rawModel.name)) {
                    throw new Error('DeepSeek Harness session.models returned an invalid model')
                }
                const reasoning = isRecord(rawModel.reasoning) ? rawModel.reasoning : null
                const defaultEffort = reasoning ? asString(reasoning.defaultEffort) : null
                const efforts = reasoning && Array.isArray(reasoning.efforts)
                    ? reasoning.efforts.map((rawEffort) => {
                        if (!isRecord(rawEffort) || !asString(rawEffort.id) || !asString(rawEffort.name)) {
                            throw new Error('DeepSeek Harness session.models returned an invalid reasoning effort')
                        }
                        return {
                            id: rawEffort.id as string,
                            name: rawEffort.name as string,
                            isDefault: rawEffort.id === defaultEffort
                        }
                    })
                    : []
                models.push({
                    provider: rawGroup.id as string,
                    providerName: rawGroup.name as string,
                    model: rawModel.id as string,
                    name: rawModel.name as string,
                    reasoningEfforts: efforts
                })
            }
        }

        return {
            current: {
                provider,
                model,
                ...(asString(currentValue.reasoningEffort)
                    ? { reasoningEffort: currentValue.reasoningEffort as string }
                    : {})
            },
            models
        }
    }

    async selectModel(options: {
        sessionId: string
        provider: string
        model: string
        reasoningEffort?: string
        signal?: AbortSignal
    }): Promise<DshModelSelection> {
        const { value } = await this.call('session.selectModel', {
            sessionId: options.sessionId,
            provider: options.provider,
            model: options.model,
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {})
        }, options.signal)
        const selected = isRecord(value) && isRecord(value.selected) ? value.selected : null
        const provider = selected ? asString(selected.provider) : null
        const model = selected ? asString(selected.model) : null
        if (!selected || !provider || !model) {
            throw new Error('DeepSeek Harness session.selectModel returned an invalid selection')
        }
        return {
            provider,
            model,
            ...(asString(selected.reasoningEffort)
                ? { reasoningEffort: selected.reasoningEffort as string }
                : {})
        }
    }

    async setPermissionPreset(sessionId: string, preset: string, signal?: AbortSignal): Promise<void> {
        await this.prompt({
            sessionId,
            text: `/permission ${preset}`,
            mode: 'queue',
            signal
        })
    }

    async respond(rpcId: string, value: unknown, signal?: AbortSignal): Promise<void> {
        await this.sendResponse(rpcId, { ok: true, value }, signal)
    }

    async cancelResponse(rpcId: string, signal?: AbortSignal): Promise<void> {
        await this.sendResponse(rpcId, {
            ok: false,
            error: { code: 'cancelled', message: 'Cancelled by HAPI client' }
        }, signal)
    }

    private async sendResponse(rpcId: string, result: unknown, signal?: AbortSignal): Promise<void> {
        if (await this.ensureAuth(signal)) {
            const unwrapped = isRecord(result) && result.ok === true && Object.hasOwn(result, 'value')
                ? result.value
                : result
            const outcome = isRecord(result) && result.ok === false
                ? {
                    kind: 'rejected',
                    error: {
                        name: 'AbortError',
                        message: isRecord(result.error) && asString(result.error.message)
                            ? result.error.message
                            : 'Cancelled by HAPI client'
                    }
                }
                : isRecord(unwrapped) && typeof unwrapped.outcome === 'string'
                    ? { kind: 'result', value: unwrapped.outcome }
                    : isRecord(unwrapped) && unwrapped.answer !== undefined
                        ? { kind: 'result', value: unwrapped.answer }
                        : { kind: 'result', value: unwrapped }
            const response = await this.fetchImpl(new URL('/api/$events/result', this.baseUrl), {
                method: 'POST',
                headers: {
                    ...(this.remoteEventCookie ? { cookie: this.remoteEventCookie } : this.headers()),
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'client-request',
                    rpcId: randomUUID(),
                    method: '$events/result',
                    payload: {
                        args: {
                            clientId: this.remoteClientId,
                            eventId: rpcId,
                            outcome
                        }
                    }
                }),
                signal
            })
            if (!response.ok) throw new Error(`DeepSeek Harness response transport failed: HTTP ${response.status}`)
            const body: unknown = await response.json()
            if (!isRecord(body) || !isRecord(body.result) || body.result.ok !== true) {
                throw new Error('DeepSeek Harness response was rejected')
            }
            return
        }
        const response = await this.fetchImpl(new URL('/api/respond', this.baseUrl), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                type: 'client-response',
                rpcId,
                result
            }),
            signal
        })
        if (!response.ok) throw new Error(`DeepSeek Harness response transport failed: HTTP ${response.status}`)
        const receipt: unknown = await response.json()
        if (!isRecord(receipt) || receipt.accepted !== true) {
            const reason = isRecord(receipt) ? asString(receipt.reason) : null
            throw new Error(`DeepSeek Harness response was rejected${reason ? `: ${reason}` : ''}`)
        }
    }

    subscribeMux(options: {
        signal: AbortSignal
        onFrame: (request: DshServerRequest) => void
        onError?: (error: Error) => void
    }): Promise<void> {
        if (this.authMode === 'remote' || this.launchToken) {
            return this.subscribeRemoteEvents(options)
        }
        const url = new URL('/api/events.mux', this.baseUrl)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(url.toString())
            let opened = false
            const abort = () => socket.close()
            options.signal.addEventListener('abort', abort, { once: true })
            socket.onopen = () => {
                opened = true
                resolve()
            }
            socket.onmessage = (message) => {
                try {
                    const parsed: unknown = JSON.parse(String(message.data))
                    if (!isRecord(parsed)
                        || parsed.type !== 'server-request'
                        || !asString(parsed.rpcId)
                        || !asString(parsed.method)
                        || !isRecord(parsed.payload)
                        || !asString(parsed.payload.type)) {
                        throw new Error('invalid mux frame')
                    }
                    options.onFrame({
                        type: 'server-request',
                        rpcId: parsed.rpcId as string,
                        method: parsed.method as string,
                        payload: parsed.payload as DshMuxFrame
                    })
                } catch (error) {
                    options.onError?.(error instanceof Error ? error : new Error(String(error)))
                }
            }
            socket.onerror = () => {
                const error = new Error('DeepSeek Harness event stream failed')
                if (!opened) reject(error)
                else options.onError?.(error)
            }
            socket.onclose = () => {
                options.signal.removeEventListener('abort', abort)
                if (!options.signal.aborted) {
                    options.onError?.(new Error('DeepSeek Harness event stream disconnected'))
                }
            }
        })
    }

    /** Open one latest DSH session.follow stream and project its entries into
     * the legacy event callback shape used by HAPI's runner. */
    subscribeSession(options: {
        sessionId: string
        signal: AbortSignal
        onEvent: (event: DshSessionEvent, view?: unknown) => void
        onSnapshot?: (records: DshHistoryEntry[], cursor?: number) => void
        onError?: (error: Error) => void
    }): Promise<void> {
        // DSH binds one API cookie to one mux peer. Use a dedicated client for
        // the long-lived follow stream so this instance can keep using its
        // cookie for unary prompt/model/cancel calls without starving the
        // stream of live event frames.
        const streamClient = new DshWebClient(this.baseUrl, this.fetchImpl, this.launchToken)
        return streamClient.ensureAuth(options.signal).then((remote) => {
            if (!remote) return
            return streamClient.openSessionStream(options)
        })
    }

    private openSessionStream(options: {
        sessionId: string
        signal: AbortSignal
        onEvent: (event: DshSessionEvent, view?: unknown) => void
        onSnapshot?: (records: DshHistoryEntry[], cursor?: number) => void
        onError?: (error: Error) => void
    }): Promise<void> {
        return this.subscribeRemoteStream({
            endpoint: 'session/follow',
            payload: {
                args: {
                    request: {
                        address: { kind: 'session', sessionId: options.sessionId },
                        assistantStream: true
                    }
                }
            },
            signal: options.signal,
            onValue: (value) => {
                if (!isRecord(value)) return
                if (value.type === 'snapshot' && Array.isArray(value.records)) {
                    const records = value.records.flatMap((record): DshHistoryEntry[] => {
                        if (!isRecord(record)) return []
                        const event = parseSessionEvent(record.event)
                        return event
                            ? [{ event, ...(record.view !== undefined ? { view: record.view } : {}) }]
                            : []
                    })
                    options.onSnapshot?.(
                        records,
                        asNumber(value.cursor) ?? undefined
                    )
                    for (const record of records) options.onEvent(record.event, record.view)
                } else if (value.type === 'entry' || value.type === 'event') {
                    this.emitFollowRecord(value, options.onEvent)
                }
            },
            onError: options.onError
        })
    }

    private emitFollowRecord(value: unknown, onEvent: (event: DshSessionEvent, view?: unknown) => void): void {
        if (!isRecord(value)) return
        const event = parseSessionEvent(value.event)
        if (event) onEvent(event, value.view)
    }

    private subscribeRemoteEvents(options: {
        signal: AbortSignal
        onFrame: (request: DshServerRequest) => void
        onError?: (error: Error) => void
    }): Promise<void> {
        const rememberCookie = this.ensureAuth(options.signal).then((remote) => {
            if (remote) this.remoteEventCookie = this.authCookie
            return remote
        })
        return rememberCookie.then((remote) => remote ? this.subscribeRemoteStream({
            endpoint: '$events',
            payload: { args: {} },
            signal: options.signal,
            onValue: (value) => {
                if (!isRecord(value)) return
                if (value.type === 'ready' && asString(value.clientId)) {
                    this.remoteClientId = value.clientId as string
                    return
                }
                if (value.type === 'waterfall' && asString(value.eventId) && asString(value.event)
                    && asString(value.agentId) && isRecord(value.request)) {
                    const event = value.event as string
                    const request = value.request
                    if (event === 'approval/request' || event === 'approval/requested') {
                        options.onFrame({
                            type: 'server-request',
                            rpcId: value.eventId as string,
                            method: event,
                            payload: {
                                type: 'approval/requested',
                                sessionId: value.agentId as string,
                                approvalId: value.eventId,
                                ...(asString(request.toolName) ? { toolName: request.toolName } : {}),
                                ...(asString(request.callId) ? { callId: request.callId } : {}),
                                ...(asString(request.reason) ? { reason: request.reason } : {})
                            }
                        })
                    } else if (event === 'user-questions/request' || event === 'question/requested') {
                        options.onFrame({
                            type: 'server-request',
                            rpcId: value.eventId as string,
                            method: event,
                            payload: {
                                type: 'question/requested',
                                sessionId: value.agentId as string,
                                questions: Array.isArray(request.questions) ? request.questions : []
                            }
                        })
                    }
                    return
                }
                // A few 0.2.x builds expose a broadcasted session/event on the
                // Remote Event stream.  Accept both [session,event] and a
                // single object form without making it a dependency.
                if (value.type === 'emit' && value.event === 'session/event' && Array.isArray(value.args)) {
                    const candidate = value.args.at(-1)
                    const event = parseSessionEvent(candidate)
                    const sessionId = value.args.length > 1 && asString(value.args[0]) ? value.args[0] : undefined
                    if (event) {
                        options.onFrame({
                            type: 'server-request',
                            rpcId: randomUUID(),
                            method: 'session/event',
                            payload: { type: 'session/event', ...(sessionId ? { sessionId } : {}), event }
                        })
                    }
                }
            },
            onError: options.onError
        }) : Promise.resolve())
    }

    private async readSessionCursor(sessionId: string, signal?: AbortSignal): Promise<number> {
        if (this.remoteEventCookie && this.authCookie === this.remoteEventCookie) {
            this.authMode = 'unknown'
            this.authCookie = undefined
            await this.ensureAuth(signal)
        }
        const controller = new AbortController()
        const abort = () => controller.abort(signal?.reason)
        signal?.addEventListener('abort', abort, { once: true })
        let cursor = -1
        try {
            await this.subscribeRemoteStream({
                endpoint: 'session/follow',
                payload: {
                    args: {
                        request: {
                            address: { kind: 'session', sessionId }
                        }
                    }
                },
                signal: controller.signal,
                waitForFirst: true,
                onValue: (value) => {
                    if (isRecord(value) && value.type === 'snapshot' && asNumber(value.cursor) !== null) {
                        cursor = value.cursor as number
                    }
                }
            })
        } finally {
            signal?.removeEventListener('abort', abort)
            controller.abort()
            // DSH binds an API cookie to the lifetime of its mux peer. Closing
            // this short-lived cursor probe retires that peer, so exchange the
            // launch token once more before the following unary page request.
            if (!signal?.aborted) {
                this.authMode = 'unknown'
                this.authCookie = undefined
                await this.ensureAuth(signal)
            }
        }
        return cursor
    }

    private subscribeRemoteStream(options: {
        endpoint: string
        payload: unknown
        signal: AbortSignal
        onValue: (value: unknown) => void
        onError?: (error: Error) => void
        waitForFirst?: boolean
    }): Promise<void> {
        return this.ensureAuth(options.signal).then(() => new Promise((resolve, reject) => {
            const url = new URL('/api/remote.mux', this.baseUrl)
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
            const WebSocketCtor = WebSocket as unknown as new (
                url: string,
                options?: { headers?: Record<string, string> }
            ) => WebSocket
            const socket = new WebSocketCtor(url.toString(), this.authCookie ? { headers: { cookie: this.authCookie } } : undefined)
            const streamId = randomUUID()
            let opened = false
            let firstItem = false
            let ended = false
            const abort = () => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'cancel', streamId }))
                }
                socket.close()
            }
            options.signal.addEventListener('abort', abort, { once: true })
            socket.onopen = () => {
                opened = true
                socket.send(JSON.stringify({
                    type: 'open',
                    streamId,
                    endpoint: options.endpoint,
                    payload: options.payload
                }))
                if (!options.waitForFirst) resolve()
            }
            socket.onmessage = (message) => {
                try {
                    const parsed: unknown = JSON.parse(String(message.data))
                    if (!isRecord(parsed) || parsed.streamId !== streamId) return
                    if (parsed.type === 'item') {
                        options.onValue(parsed.value)
                        if (options.waitForFirst && !firstItem) {
                            firstItem = true
                            resolve()
                        }
                    } else if (parsed.type === 'error') {
                        const errorValue = isRecord(parsed.error) ? parsed.error : {}
                        throw new Error(asString(errorValue.message) ?? 'DeepSeek Harness remote stream failed')
                    } else if (parsed.type === 'end') {
                        ended = true
                        socket.close()
                    }
                } catch (error) {
                    const failure = error instanceof Error ? error : new Error(String(error))
                    if (!opened) reject(failure)
                    else options.onError?.(failure)
                }
            }
            socket.onerror = () => {
                const error = new Error('DeepSeek Harness remote stream failed')
                if (!opened) reject(error)
                else options.onError?.(error)
            }
            socket.onclose = () => {
                options.signal.removeEventListener('abort', abort)
                if (!options.signal.aborted && !ended) {
                    const error = new Error('DeepSeek Harness remote stream disconnected')
                    if (!opened) reject(error)
                    else options.onError?.(error)
                }
            }
        }))
    }

    private headers(extra?: Record<string, string>): Record<string, string> {
        return {
            ...(this.authCookie ? { cookie: this.authCookie } : {}),
            ...(extra ?? {})
        }
    }

    private async ensureAuth(signal?: AbortSignal): Promise<boolean> {
        if (this.authMode === 'remote') return true
        if (this.authMode === 'legacy') return false
        if (!this.launchToken) {
            this.authMode = 'legacy'
            return false
        }
        const url = new URL('/connect', this.baseUrl)
        url.searchParams.set('token', this.launchToken)
        url.searchParams.set('interactions', 'answer')
        let response: Response
        try {
            response = await this.fetchImpl(url, {
                method: 'GET',
                redirect: 'manual',
                signal
            })
        } catch (error) {
            throw new Error(`Unable to authenticate with DeepSeek Harness at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`)
        }
        if (response.status < 300 || response.status >= 400) {
            throw new Error(`DeepSeek Harness authentication failed: HTTP ${response.status}`)
        }
        const setCookie = typeof response.headers.getSetCookie === 'function'
            ? response.headers.getSetCookie()[0]
            : response.headers.get('set-cookie')
        if (!setCookie) throw new Error('DeepSeek Harness authentication did not return an API cookie')
        this.authCookie = setCookie.split(';', 1)[0]
        this.authMode = 'remote'
        return true
    }

    private async call(
        method: string,
        payload: unknown,
        signal?: AbortSignal,
        timeoutMs = 30_000,
        requestedRpcId?: string
    ): Promise<{ rpcId: string; value: unknown }> {
        const rpcId = requestedRpcId ?? randomUUID()
        const timeout = AbortSignal.timeout(timeoutMs)
        const combined = signal ? AbortSignal.any([timeout, signal]) : timeout
        let response: Response
        try {
            const remote = await this.ensureAuth(combined)
            // The generated Remote gateway reserves one `args` object.  Keep
            // the old wire shape when no launch token is configured so HAPI
            // remains usable with a 0.1.x host during a rolling upgrade.
            const args = remote
                ? method === 'session.list' && isRecord(payload) && Object.keys(payload).length === 0
                    ? { _request: {} }
                    : ['session.create', 'session.prompt', 'session.cancel', 'session.selectModel'].includes(method)
                        ? isRecord(payload) && Object.keys(payload).length === 1 && isRecord(payload.request)
                            ? payload
                            : { request: payload }
                    : method === 'commands/execute' && isRecord(payload) && isRecord(payload.args)
                        ? {
                            ...(isRecord(payload.args) && asString(payload.args.agentId)
                                ? { agentId: payload.args.agentId }
                                : {}),
                            ...(isRecord(payload.args) && typeof payload.args.line === 'string'
                                ? { line: payload.args.line }
                                : {}),
                            submittedAttachments: isRecord(payload.args) && Array.isArray(payload.args.images)
                                ? payload.args.images
                                : []
                        }
                        : payload
                : payload
            const wireMethod = remote ? method.replace('.', '/') : method
            response = await this.fetchImpl(new URL(`/api/${wireMethod}`, this.baseUrl), {
                method: 'POST',
                headers: this.headers({ 'content-type': 'application/json' }),
                body: JSON.stringify({
                    type: 'client-request',
                    rpcId,
                    method: wireMethod,
                    payload: remote ? { args } : payload
                }),
                signal: combined
            })
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            throw new Error(
                `Unable to reach DeepSeek Harness at ${this.baseUrl}. ` +
                `Start it with \`dsh web --port ${new URL(this.baseUrl).port || '3080'}\` or set HAPI_DSH_URL. ${detail}`
            )
        }
        if (!response.ok) throw new Error(`DeepSeek Harness ${method} transport failed: HTTP ${response.status}`)
        const body: unknown = await response.json()
        if (!isRecord(body) || body.type !== 'server-response' || body.rpcId !== rpcId || !isRecord(body.result)) {
            throw new Error(`DeepSeek Harness ${method} returned an invalid RPC envelope`)
        }
        if (body.result.ok !== true) {
            const error = isRecord(body.result.error) ? body.result.error : {}
            throw new DshWebRpcError(
                method,
                asString(error.code) ?? 'unknown',
                asString(error.message) ?? 'Unknown error',
                error.details
            )
        }
        return { rpcId, value: body.result.value }
    }
}
