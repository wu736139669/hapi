import type { Database } from 'bun:sqlite'
import type { StoredSession } from './types'
import { getMessageEpoch, getMessagesAfterSeq } from './messages'
import { getSession } from './sessions'
import { parseUsageEvent, sessionModel } from './usageParser'
import { getUsageSources, rememberUsageSource, rememberSessionUsageSources, usageSourceLedgerId, type UsageSource } from './usageSources'

import {
    getReconciledUsageByNamespace,
    getUsageEvents,
    getUsageEventsByNamespace,
    getUsageScanStates,
    recordUsageScan,
    recordUsageEvents,
    replaceReconciledUsage,
    transferUsageSession,
    type ReconciledUsageRow,
    type UsageEvent,
    type UsageScanState
} from './usage'

export function collectUsageEvents(db: Database, sessions: StoredSession[]): void {
    const scanStates = getUsageScanStates(db, sessions.map((session) => session.id))
    for (const session of sessions) {
        rememberSessionUsageSources(db, session)
        const messageEpoch = getMessageEpoch(db, session.id)
        const scanState = scanStates.get(session.id)
        const replaceEvents = !scanState || scanState.messageEpoch !== messageEpoch
        const afterSeq = replaceEvents ? 0 : scanState.lastSeq
        const messages = getMessagesAfterSeq(db, session.id, afterSeq)
        const events = new Map<string, UsageEvent>()
        let indexedModels: Map<string, string> | null = null
        const getIndexedModel = (sourceKey: string): string | null => {
            if (indexedModels === null) {
                indexedModels = new Map(
                    getUsageEvents(db, [session.id])
                        .filter((event): event is UsageEvent & { model: string } => event.model !== null)
                        .map((event) => [event.sourceKey, event.model])
                )
            }
            return indexedModels.get(sourceKey) ?? null
        }
        const fallbackModel = sessionModel(session)
        for (const message of messages) {
            const event = parseUsageEvent(session, message)
            if (!event) continue
            const existingEvent = events.get(event.sourceKey)
            const explicitModel = event.model
            event.model = explicitModel
                ?? existingEvent?.model
                ?? getIndexedModel(event.sourceKey)
                ?? fallbackModel
            if (event.kind === 'delta' || !existingEvent) {
                events.set(event.sourceKey, event)
            } else if (explicitModel !== null) {
                // A replay may add model metadata missing from the original snapshot.
                existingEvent.model = explicitModel
            }
        }
        const lastSeq = messages.at(-1)?.seq ?? afterSeq
        if (messages.length > 0 || replaceEvents) {
            recordUsageScan(
                db,
                session.id,
                session.namespace,
                messageEpoch,
                lastSeq,
                Array.from(events.values()),
                replaceEvents
            )
        }
    }
}

export class UsageStore {
    constructor(private readonly db: Database) {}

    collectSessions(sessions: StoredSession[]): void {
        collectUsageEvents(this.db, sessions)
    }

    rememberSource(source: UsageSource): void {
        rememberUsageSource(this.db, source)
    }

    rememberSessionSources(session: StoredSession): void {
        rememberSessionUsageSources(this.db, session)
    }

    getSources(namespace?: string, machineId?: string): UsageSource[] {
        return getUsageSources(this.db, namespace, machineId)
    }

    /** Repair records written with swapped namespace/session columns by the old merge path. */
    repairTransferredEvents(namespace: string): number {
        return this.db.transaction(() => {
            // Some deleted merge targets have no retained metadata. A native
            // recovery can already have restored their exact provider keys;
            // remove only those verified duplicate misplaced rows.
            const duplicateRepair = this.db.prepare(`DELETE FROM usage_events AS broken
                WHERE broken.session_id = ? AND length(broken.namespace) = 36
                    AND substr(broken.namespace, 9, 1) = '-'
                    AND EXISTS (SELECT 1 FROM usage_events AS recovered
                        WHERE recovered.namespace = ? AND recovered.agent = broken.agent
                            AND recovered.source_key = broken.source_key)`)
                .run(namespace, namespace).changes
            const misplaced = this.db.prepare(`SELECT DISTINCT namespace FROM usage_events
                WHERE session_id = ? AND namespace IN (
                    SELECT id FROM sessions WHERE namespace = ?
                    UNION SELECT session_id FROM usage_session_sources WHERE namespace = ?)`)
                .all(namespace, namespace, namespace) as Array<{ namespace: string }>
            let repaired = duplicateRepair
            for (const row of misplaced) {
                const events = getUsageEventsByNamespace(this.db, row.namespace)
                    .filter((event) => event.sessionId === namespace)
                    .map((event) => ({ ...event, sessionId: row.namespace }))
                recordUsageEvents(this.db, namespace, events)
                this.db.prepare('DELETE FROM usage_events WHERE namespace = ? AND session_id = ?')
                    .run(row.namespace, namespace)
                repaired += events.length
            }
            return repaired
        })()
    }

    reconcileSource(source: UsageSource, rows: Omit<ReconciledUsageRow, 'sessionId'>[], updatedAt: number): void {
        if (rows.length === 0) return
        this.db.transaction(() => {
            rememberUsageSource(this.db, source)
            const aliases = getUsageSources(this.db, source.namespace, source.machineId)
                .filter((entry) => entry.agent === source.agent && entry.nativeSessionId === source.nativeSessionId)
            const ledgerId = usageSourceLedgerId(source)
            const ids = [ledgerId, ...aliases.map((alias) => alias.sessionId)]
            const latest = this.db.prepare(`SELECT MAX(updated_at) AS updatedAt FROM usage_reconciliation
                WHERE namespace = ? AND agent = ? AND session_id IN (${ids.map(() => '?').join(',')})`)
                .get(source.namespace, source.agent, ...ids) as { updatedAt: number | null }
            if (latest.updatedAt !== null && latest.updatedAt > updatedAt) return
            for (const alias of aliases) {
                this.db.prepare('DELETE FROM usage_reconciliation WHERE namespace = ? AND session_id = ? AND agent = ?')
                    .run(source.namespace, alias.sessionId, source.agent)
            }
            replaceReconciledUsage(this.db, source.namespace, ledgerId,
                rows.map((row) => ({ ...row, agent: source.agent, sessionId: ledgerId })), updatedAt)
        })()
    }

    recordScan(
        sessionId: string,
        namespace: string,
        messageEpoch: number,
        lastSeq: number,
        events: UsageEvent[],
        replaceEvents: boolean
    ): void {
        recordUsageScan(this.db, sessionId, namespace, messageEpoch, lastSeq, events, replaceEvents)
    }

    getEvents(sessionIds: string[]): UsageEvent[] {
        return getUsageEvents(this.db, sessionIds)
    }

    getEventsByNamespace(namespace: string): UsageEvent[] {
        return getUsageEventsByNamespace(this.db, namespace)
    }

    getScanStates(sessionIds: string[]): Map<string, UsageScanState> {
        return getUsageScanStates(this.db, sessionIds)
    }

    transferSession(fromSessionId: string, toSessionId: string): void {
        this.db.transaction(() => {
            const source = getSession(this.db, fromSessionId)
            if (source) collectUsageEvents(this.db, [source])
            const legacy = this.db.prepare('SELECT DISTINCT namespace, agent FROM usage_reconciliation WHERE session_id = ?')
                .all(fromSessionId) as Array<{ namespace: string; agent: string }>
            for (const row of legacy) {
                const hasSource = getUsageSources(this.db, row.namespace)
                    .some((entry) => entry.sessionId === fromSessionId && entry.agent === row.agent)
                if (!hasSource) {
                    rememberUsageSource(this.db, { ...row, machineId: '',
                        nativeSessionId: `usage-ledger:${fromSessionId}`, sessionId: fromSessionId })
                }
            }
            transferUsageSession(this.db, fromSessionId, toSessionId)
        })()
    }

    replaceReconciled(sessionId: string, namespace: string, rows: ReconciledUsageRow[], updatedAt: number): void {
        replaceReconciledUsage(this.db, namespace, sessionId, rows, updatedAt)
    }

    getReconciledByNamespace(namespace: string): ReconciledUsageRow[] {
        return getReconciledUsageByNamespace(this.db, namespace)
    }
}
