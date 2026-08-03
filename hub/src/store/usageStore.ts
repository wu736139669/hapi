import type { Database } from 'bun:sqlite'

import {
    getMaxUsageSourceSeqBySession,
    getUsageEvents,
    upsertUsageEvents,
    type UsageEvent
} from './usage'

export class UsageStore {
    constructor(private readonly db: Database) {}

    upsertEvents(events: UsageEvent[]): void {
        upsertUsageEvents(this.db, events)
    }

    getEvents(sessionIds: string[]): UsageEvent[] {
        return getUsageEvents(this.db, sessionIds)
    }

    getMaxSourceSeqBySession(sessionIds: string[]): Map<string, number> {
        return getMaxUsageSourceSeqBySession(this.db, sessionIds)
    }
}
