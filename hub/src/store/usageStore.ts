import type { Database } from 'bun:sqlite'

import {
    getReconciledUsageByNamespace,
    getUsageEvents,
    getUsageEventsByNamespace,
    getUsageScanStates,
    recordUsageScan,
    replaceReconciledUsage,
    transferUsageSession,
    type ReconciledUsageRow,
    type UsageEvent,
    type UsageScanState
} from './usage'

export class UsageStore {
    constructor(private readonly db: Database) {}

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
        transferUsageSession(this.db, fromSessionId, toSessionId)
    }

    replaceReconciled(sessionId: string, namespace: string, rows: ReconciledUsageRow[], updatedAt: number): void {
        replaceReconciledUsage(this.db, namespace, sessionId, rows, updatedAt)
    }

    getReconciledByNamespace(namespace: string): ReconciledUsageRow[] {
        return getReconciledUsageByNamespace(this.db, namespace)
    }
}
