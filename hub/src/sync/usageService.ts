import type { UsageSummaryBucket, UsageSummaryResponse } from '@hapi/protocol/apiTypes'
import type { StoredMessage, StoredSession } from '../store'
import type { UsageEvent } from '../store/usage'
import type { Store } from '../store'

type RecordValue = Record<string, unknown>

function asRecord(value: unknown): RecordValue | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as RecordValue
        : null
}

function asCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : null
}

function firstCount(record: RecordValue, ...keys: string[]): number {
    for (const key of keys) {
        const value = asCount(record[key])
        if (value !== null) return value
    }
    return 0
}

function sessionAgent(session: StoredSession): string {
    const metadata = asRecord(session.metadata)
    const flavor = metadata?.flavor
    return typeof flavor === 'string' && flavor.trim() ? flavor.trim() : 'unknown'
}

function sessionModel(session: StoredSession): string | null {
    return typeof session.model === 'string' && session.model.trim() ? session.model.trim() : null
}

function parseUsageEvent(session: StoredSession, message: StoredMessage): UsageEvent | null {
    const envelope = asRecord(message.content)
    if (envelope?.role !== 'agent') return null

    const payload = asRecord(envelope.content)
    if (!payload) return null
    const data = asRecord(payload.data)
    if (!data) return null

    // Claude stream-json/SDK messages. A stream emits several updates for one
    // assistant message, so the provider's message id is the stable upsert key.
    if (payload.type === 'output' && data.type === 'assistant') {
        const assistant = asRecord(data.message)
        const usage = asRecord(assistant?.usage)
        if (!usage) return null
        const inputTokens = firstCount(usage, 'input_tokens', 'inputTokens')
        const outputTokens = firstCount(usage, 'output_tokens', 'outputTokens')
        const cacheReadTokens = firstCount(usage, 'cache_read_input_tokens', 'cacheReadTokens', 'cachedInputTokens')
        const cacheCreationTokens = firstCount(usage, 'cache_creation_input_tokens', 'cacheCreationTokens', 'cacheWriteInputTokens')
        if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens <= 0) return null
        const providerId = typeof assistant?.id === 'string' ? assistant.id : message.id
        const model = typeof assistant?.model === 'string' && assistant.model.trim()
            ? assistant.model.trim()
            : sessionModel(session)
        return {
            sessionId: session.id,
            sourceKey: `claude|${providerId}`,
            sourceSeq: message.seq,
            createdAt: message.createdAt,
            agent: 'claude',
            model,
            kind: 'delta',
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens
        }
    }

    // Codex and ACP-compatible backends forward token_count snapshots. The
    // `total` object is cumulative for a thread; aggregation below diffs it.
    if (data.type === 'token_count' || data.type === 'usage') {
        const info = asRecord(data.info) ?? data
        const total = asRecord(info.total) ?? info
        const inputTokens = firstCount(total, 'inputTokens', 'input_tokens')
        const outputTokens = firstCount(total, 'outputTokens', 'output_tokens')
        const cacheReadTokens = firstCount(total, 'cachedInputTokens', 'cached_input_tokens', 'cacheReadTokens', 'cache_read_input_tokens')
        const cacheCreationTokens = firstCount(total, 'cacheWriteInputTokens', 'cache_write_input_tokens', 'cacheCreationTokens', 'cache_creation_input_tokens')
        if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens <= 0) return null
        const threadId = typeof data.threadId === 'string'
            ? data.threadId
            : typeof data.thread_id === 'string'
                ? data.thread_id
                : session.id
        const scope = typeof data.scopeRole === 'string'
            ? data.scopeRole
            : typeof data.scope_role === 'string'
                ? data.scope_role
                : 'parent'
        const agent = sessionAgent(session)
        return {
            sessionId: session.id,
            sourceKey: `cumulative|${threadId}|${scope}|${message.id}`,
            sourceSeq: message.seq,
            createdAt: message.createdAt,
            agent,
            model: sessionModel(session),
            kind: 'cumulative',
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens
        }
    }

    return null
}

function collectUsageEvents(store: Store, sessions: StoredSession[]): void {
    const events: UsageEvent[] = []
    const maxSourceSeq = store.usage.getMaxSourceSeqBySession(sessions.map((session) => session.id))
    for (const session of sessions) {
        const afterSeq = maxSourceSeq.get(session.id) ?? 0
        const messages = store.messages.getAllMessages(session.id)
        for (const message of messages) {
            if (afterSeq > 0 && message.seq <= afterSeq) continue
            const event = parseUsageEvent(session, message)
            if (event) events.push(event)
        }
    }
    store.usage.upsertEvents(events)
}

type Totals = Omit<UsageSummaryBucket, 'key'>

function emptyTotals(): Totals {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        requests: 0
    }
}

function addTotals(target: Totals, inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheCreationTokens: number): void {
    target.inputTokens += inputTokens
    target.outputTokens += outputTokens
    target.cacheReadTokens += cacheReadTokens
    target.cacheCreationTokens += cacheCreationTokens
    // Codex/Kimi inputTokens already includes cached input. Claude's raw
    // input_tokens excludes cache fields and is normalized before this call.
    target.totalTokens += inputTokens + outputTokens
    target.requests += 1
}

function toBucket(key: string, totals: Totals): UsageSummaryBucket {
    return { key, ...totals }
}

function dayKey(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10)
}

export function getUsageSummary(store: Store, namespace: string, range: string | undefined): UsageSummaryResponse {
    const sessions = store.sessions.getSessionsByNamespace(namespace)
    // This is intentionally lazy. Existing HAPI databases have no usage table;
    // the first dashboard request backfills history, while later requests only
    // update the idempotent event rows.
    collectUsageEvents(store, sessions)

    const now = Date.now()
    const days = range === '30d' ? 30 : range === 'all' ? null : 7
    const from = days === null ? null : now - days * 24 * 60 * 60 * 1000
    const sessionIds = new Set(sessions.map((session) => session.id))
    const events = store.usage.getEvents(Array.from(sessionIds))
    const isInRange = (event: UsageEvent) => (from === null || event.createdAt >= from) && event.createdAt <= now

    const totals = emptyTotals()
    const daily = new Map<string, Totals>()
    const byAgent = new Map<string, Totals>()
    const byModel = new Map<string, Totals>()
    const sessionsWithUsage = new Set<string>()
    const cumulativePrevious = new Map<string, [number, number, number, number]>()

    for (const event of events) {
        let inputTokens = event.inputTokens
        let outputTokens = event.outputTokens
        let cacheReadTokens = event.cacheReadTokens
        let cacheCreationTokens = event.cacheCreationTokens
        if (event.kind === 'cumulative') {
            const streamKey = event.sourceKey.split('|').slice(0, 3).join('|')
            const previous = cumulativePrevious.get(streamKey)
            if (previous) {
                inputTokens = inputTokens >= previous[0] ? inputTokens - previous[0] : inputTokens
                outputTokens = outputTokens >= previous[1] ? outputTokens - previous[1] : outputTokens
                cacheReadTokens = cacheReadTokens >= previous[2] ? cacheReadTokens - previous[2] : cacheReadTokens
                cacheCreationTokens = cacheCreationTokens >= previous[3] ? cacheCreationTokens - previous[3] : cacheCreationTokens
            }
            cumulativePrevious.set(streamKey, [event.inputTokens, event.outputTokens, event.cacheReadTokens, event.cacheCreationTokens])
        }
        if (!isInRange(event) || inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens <= 0) continue
        const normalizedInputTokens = event.agent === 'claude'
            ? inputTokens + cacheReadTokens + cacheCreationTokens
            : inputTokens
        addTotals(totals, normalizedInputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        const dailyTotals = daily.get(dayKey(event.createdAt)) ?? emptyTotals()
        addTotals(dailyTotals, normalizedInputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        daily.set(dayKey(event.createdAt), dailyTotals)
        const agentTotals = byAgent.get(event.agent) ?? emptyTotals()
        addTotals(agentTotals, normalizedInputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        byAgent.set(event.agent, agentTotals)
        const modelKey = event.model ?? 'unknown'
        const modelTotals = byModel.get(modelKey) ?? emptyTotals()
        addTotals(modelTotals, normalizedInputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        byModel.set(modelKey, modelTotals)
        sessionsWithUsage.add(event.sessionId)
    }

    const sortBuckets = (values: Map<string, Totals>): UsageSummaryBucket[] => Array.from(values.entries())
        .map(([key, value]) => toBucket(key, value))
        .sort((a, b) => b.totalTokens - a.totalTokens)

    return {
        range: { from, to: now },
        totals: { ...totals, sessions: sessionsWithUsage.size },
        daily: Array.from(daily.entries())
            .map(([key, value]) => toBucket(key, value))
            .sort((a, b) => a.key.localeCompare(b.key)),
        byAgent: sortBuckets(byAgent),
        byModel: sortBuckets(byModel),
        updatedAt: now
    }
}
