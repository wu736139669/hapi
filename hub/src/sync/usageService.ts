import type { UsageSummaryBucket, UsageSummaryResponse } from '@hapi/protocol/apiTypes'
import type { UsageEvent } from '../store/usage'
import type { Store } from '../store'
import { usageSourceLedgerId } from '../store/usageSources'

type Totals = Omit<UsageSummaryBucket, 'key'>

function emptyTotals(): Totals {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        uncachedTokens: 0,
        requests: 0
    }
}

function addTotals(
    target: Totals,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheCreationTokens: number,
    requests: number = 1
): void {
    target.inputTokens += inputTokens
    target.outputTokens += outputTokens
    target.cacheReadTokens += cacheReadTokens
    target.cacheCreationTokens += cacheCreationTokens
    // Codex/Kimi inputTokens already includes cached input. Claude's raw
    // input_tokens excludes cache fields and is normalized before this call.
    target.totalTokens += inputTokens + outputTokens
    target.uncachedTokens += Math.max(0, inputTokens - cacheReadTokens) + outputTokens
    target.requests += requests
}

type UsageSnapshot = [number, number, number, number]

function cumulativeSnapshotDelta(
    current: UsageSnapshot,
    previous: UsageSnapshot | null,
    last: UsageSnapshot | null
): UsageSnapshot {
    // A provider reset applies to the entire snapshot. Mixing a `last` value
    // for one regressed counter with deltas from the old baseline for the other
    // counters invents a request that never existed.
    const reset = previous === null || current.some((value, index) => value < previous[index])
    if (reset) return last ?? current
    return current.map((value, index) => value - previous[index]) as UsageSnapshot
}

function toBucket(key: string, totals: Totals): UsageSummaryBucket {
    return { key, ...totals }
}

function createDayFormatter(timeZone: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        calendar: 'iso8601',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    })
}

function dayKey(timestamp: number, formatter: Intl.DateTimeFormat): string {
    const parts = formatter.formatToParts(new Date(timestamp))
    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value
    if (!year || !month || !day) throw new Error('Failed to format usage day')
    return `${year}-${month}-${day}`
}

export function getUsageSummary(
    store: Store,
    namespace: string,
    range: string | undefined,
    timeZone: string = 'UTC'
): UsageSummaryResponse {
    const sessions = store.sessions.getSessionsByNamespace(namespace)
    // New messages are indexed on insertion. Backfill history from older hubs
    // and refresh usage after structural transcript changes.
    store.usage.collectSessions(sessions)

    const now = Date.now()
    const days = range === '30d' ? 30 : range === 'all' ? null : 7
    const from = days === null ? null : now - days * 24 * 60 * 60 * 1000
    // Read the durable namespace ledger rather than only live session ids;
    // usage rows intentionally survive session deletion.
    const events = store.usage.getEventsByNamespace(namespace)
    // OpenCode snapshot rows below replace the live OpenCode events of the
    // same session: the live pipeline under-counts turns that report usage
    // only for their final step, and mixing both sources would double count
    // the steps it did see. See usageReconciliation.ts.
    const allReconciledRows = store.usage.getReconciledByNamespace(namespace)
    const snapshotIds = new Set(allReconciledRows.map((row) => `${row.sessionId}|${row.agent}`))
    const sources = store.usage.getSources(namespace)
    // Native ledger ids and old/resumed HAPI ids are aliases of a billed
    // conversation. Count that conversation once across merges and clears.
    const sessionAliases = new Map<string, string>()
    const canonicalSession = (id: string): string => {
        const parent = sessionAliases.get(id)
        if (!parent || parent === id) return id
        const root = canonicalSession(parent)
        sessionAliases.set(id, root)
        return root
    }
    for (const source of sources) {
        const native = canonicalSession(usageSourceLedgerId(source))
        const session = canonicalSession(source.sessionId)
        if (native !== session) sessionAliases.set(native, session)
    }
    const supersededLegacySnapshots = new Set(sources
        .filter((source) => snapshotIds.has(`${usageSourceLedgerId(source)}|${source.agent}`))
        .map((source) => `${source.sessionId}|${source.agent}`))
    // A previous hub can leave a newer session-keyed report beside a restored
    // native snapshot. They describe the same requests, so count the native
    // source once while the next reconciliation refreshes its full totals.
    const reconciledRows = allReconciledRows.filter((row) => !supersededLegacySnapshots.has(`${row.sessionId}|${row.agent}`))
    const reconciledSessions = new Set(reconciledRows.map((row) => `${row.sessionId}|${row.agent}`))
    const reconciledSources = new Set(sources
        .filter((source) => reconciledSessions.has(`${source.sessionId}|${source.agent}`)
            || reconciledSessions.has(`${usageSourceLedgerId(source)}|${source.agent}`))
        .map((source) => `${source.machineId}|${source.agent}|${source.nativeSessionId}`))
    for (const source of sources) {
        if (reconciledSources.has(`${source.machineId}|${source.agent}|${source.nativeSessionId}`)) {
            reconciledSessions.add(`${source.sessionId}|${source.agent}`)
        }
    }
    const isInRange = (event: UsageEvent) => (from === null || event.createdAt >= from) && event.createdAt <= now

    const totals = emptyTotals()
    const daily = new Map<string, Totals>()
    const byAgent = new Map<string, Totals>()
    const byModel = new Map<string, Totals>()
    const sessionsWithUsage = new Set<string>()
    const cumulativePrevious = new Map<string, UsageSnapshot>()
    const cumulativeFingerprints = new Set<string>()
    const dayFormatter = createDayFormatter(timeZone)

    for (const event of events) {
        let inputTokens = event.inputTokens
        let outputTokens = event.outputTokens
        let cacheReadTokens = event.cacheReadTokens
        let cacheCreationTokens = event.cacheCreationTokens
        let duplicateCumulativeEvent = false
        if (event.kind === 'cumulative') {
            const sourceParts = event.sourceKey.split('|')
            // Provider thread ids are only unique within a HAPI session. Keep
            // deleted-session history from altering a newer session's delta.
            // Parent/child labels describe presentation, not distinct billing
            // streams. Native thread identity keeps replayed traces from
            // starting another cumulative baseline under a different label.
            const streamKey = `${event.sessionId}|${sourceParts.slice(0, 2).join('|')}`
            const previous = cumulativePrevious.get(streamKey) ?? null
            const current: UsageSnapshot = [
                event.inputTokens,
                event.outputTokens,
                event.cacheReadTokens,
                event.cacheCreationTokens
            ]
            const last: UsageSnapshot | null = event.lastInputTokens !== null
                && event.lastOutputTokens !== null
                && event.lastCacheReadTokens !== null
                && event.lastCacheCreationTokens !== null
                ? [
                    event.lastInputTokens,
                    event.lastOutputTokens,
                    event.lastCacheReadTokens,
                    event.lastCacheCreationTokens
                ]
                : null
            const delta = cumulativeSnapshotDelta(current, previous, last)
            inputTokens = delta[0]
            outputTokens = delta[1]
            cacheReadTokens = delta[2]
            cacheCreationTokens = delta[3]
            cumulativePrevious.set(streamKey, current)
            const turnId = sourceParts[3]
            if (turnId) {
                const fingerprint = [
                    event.sessionId,
                    turnId,
                    event.inputTokens,
                    event.outputTokens,
                    event.cacheReadTokens,
                    event.cacheCreationTokens,
                    event.lastInputTokens,
                    event.lastOutputTokens,
                    event.lastCacheReadTokens,
                    event.lastCacheCreationTokens
                ].join('|')
                duplicateCumulativeEvent = cumulativeFingerprints.has(fingerprint)
                cumulativeFingerprints.add(fingerprint)
            }
        }
        if (duplicateCumulativeEvent || !isInRange(event) || inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens <= 0) continue
        // Skip only the live OpenCode rows of a reconciled session: the
        // snapshot replaces them. Other agents' events on the same session
        // (e.g. after a flavor switch) still count.
        if (reconciledSessions.has(`${event.sessionId}|${event.agent}`)) continue
        // Cache reads and writes partition processed input. Preserve the
        // request and its primary token counts when a provider emits an
        // impossible partition, but conservatively decline to credit either
        // cache bucket because their split is not trustworthy.
        if (cacheReadTokens + cacheCreationTokens > inputTokens) {
            cacheReadTokens = 0
            cacheCreationTokens = 0
        }
        addTotals(totals, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        const eventDayKey = dayKey(event.createdAt, dayFormatter)
        const dailyTotals = daily.get(eventDayKey) ?? emptyTotals()
        addTotals(dailyTotals, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        daily.set(eventDayKey, dailyTotals)
        const agentTotals = byAgent.get(event.agent) ?? emptyTotals()
        addTotals(agentTotals, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        byAgent.set(event.agent, agentTotals)
        const modelKey = event.model ?? 'unknown'
        const modelTotals = byModel.get(modelKey) ?? emptyTotals()
        addTotals(modelTotals, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
        byModel.set(modelKey, modelTotals)
        sessionsWithUsage.add(canonicalSession(event.sessionId))
    }

    // Reconciliation rows are absolute per-day totals, so range filtering
    // compares day keys rather than event timestamps. Snapshot days are keyed
    // in the hub's local timezone; when the request asks for another timezone
    // the daily bucket boundary can drift by at most one day.
    const fromDayKey = from === null ? null : dayKey(from, dayFormatter)
    const nowDayKey = dayKey(now, dayFormatter)
    for (const row of reconciledRows) {
        if (fromDayKey !== null && row.day < fromDayKey) continue
        if (row.day > nowDayKey) continue
        addTotals(totals, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheCreationTokens, row.requests)
        const dailyTotals = daily.get(row.day) ?? emptyTotals()
        addTotals(dailyTotals, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheCreationTokens, row.requests)
        daily.set(row.day, dailyTotals)
        const agentTotals = byAgent.get(row.agent) ?? emptyTotals()
        addTotals(agentTotals, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheCreationTokens, row.requests)
        byAgent.set(row.agent, agentTotals)
        const modelTotals = byModel.get(row.model) ?? emptyTotals()
        addTotals(modelTotals, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheCreationTokens, row.requests)
        byModel.set(row.model, modelTotals)
        sessionsWithUsage.add(canonicalSession(row.sessionId))
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
