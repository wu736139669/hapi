import type { Store } from '../store'
import type { UsageEvent } from '../store/usage'

export type UsageRecoveryResult = { inserted: number; matched: number; enriched: number }

function counters(event: UsageEvent): string {
    return [event.agent, event.inputTokens, event.outputTokens, event.cacheReadTokens, event.cacheCreationTokens].join('|')
}

function cumulativeFingerprint(event: UsageEvent): string {
    return `${event.sourceKey.split('|')[1]}|${counters(event)}`
}

/** Merge native/backup accounting without adding another copy of recorded requests. */
export function mergeRecoveredUsage(
    store: Store,
    namespace: string,
    recovered: UsageEvent[],
    authoritativeModels: ReadonlySet<string> = new Set()
): UsageRecoveryResult {
    const existing = store.usage.getEventsByNamespace(namespace)
    const stableKeys = new Map(existing.map((event) => [`${event.agent}|${event.sourceKey}`, event]))
    const cumulative = new Map<string, UsageEvent[]>()
    const deltas = new Map<string, UsageEvent[]>()
    for (const event of existing) {
        const index = event.kind === 'cumulative' ? cumulative : deltas
        const key = event.kind === 'cumulative' ? cumulativeFingerprint(event) : `${event.sessionId}|${counters(event)}`
        const values = index.get(key) ?? []
        values.push(event)
        index.set(key, values)
    }
    const consumed = new Set<string>()
    const writes = new Map<string, UsageEvent[]>()
    const result: UsageRecoveryResult = { inserted: 0, matched: 0, enriched: 0 }
    for (const event of recovered) {
        if (event.inputTokens + event.outputTokens <= 0) continue
        const identity = `${event.agent}|${event.sourceKey}`
        const exact = stableKeys.get(identity)
        const candidates = event.kind === 'cumulative'
            ? cumulative.get(cumulativeFingerprint(event))
            : event.agent === 'claude' ? undefined : deltas.get(`${event.sessionId}|${counters(event)}`)
        const match = exact ?? candidates?.find((candidate) => !consumed.has(`${candidate.sessionId}|${candidate.sourceKey}`))
        if (match) {
            consumed.add(`${match.sessionId}|${match.sourceKey}`)
            result.matched += 1
            const moreCompleteDelta = event.kind === 'delta' && exact && (
                event.inputTokens > match.inputTokens || event.outputTokens > match.outputTokens
                || event.cacheReadTokens > match.cacheReadTokens || event.cacheCreationTokens > match.cacheCreationTokens
            )
            if (moreCompleteDelta || ((!match.model || match.model === 'unknown') && event.model)
                || (authoritativeModels.has(identity) && event.model !== null && event.model !== match.model)) {
                const values = writes.get(match.sessionId) ?? []
                values.push({
                    ...match,
                    model: event.model ?? match.model,
                    inputTokens: Math.max(match.inputTokens, event.inputTokens),
                    outputTokens: Math.max(match.outputTokens, event.outputTokens),
                    cacheReadTokens: Math.max(match.cacheReadTokens, event.cacheReadTokens),
                    cacheCreationTokens: Math.max(match.cacheCreationTokens, event.cacheCreationTokens)
                })
                writes.set(match.sessionId, values)
                result.enriched += 1
            }
            continue
        }
        const values = writes.get(event.sessionId) ?? []
        values.push(event)
        writes.set(event.sessionId, values)
        stableKeys.set(identity, event)
        result.inserted += 1
    }
    for (const [sessionId, events] of writes) {
        const state = store.usage.getScanStates([sessionId]).get(sessionId)
        store.usage.recordScan(sessionId, namespace, state?.messageEpoch ?? 0, state?.lastSeq ?? 0, events, false)
    }
    return result
}
