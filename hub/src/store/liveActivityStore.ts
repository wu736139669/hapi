import type { Database } from 'bun:sqlite'

import type { StoredLiveActivityToken } from './types'
import {
    getLiveActivityTokensForSession,
    listLiveActivitySessionRefs,
    listLiveActivityTokens,
    listLiveActivityTokensForAnySession,
    pruneLiveActivityTokens,
    removeLiveActivityTokenByToken,
    removeLiveActivityTokens,
    removeLiveActivityTokensForSession,
    upsertLiveActivityToken
} from './liveActivities'

/**
 * Per-device Live Activity push tokens. This is deliberately separate from
 * `fcm_devices`: an activity token is a different capability (it can only
 * update the one activity the app created), and the normal device upsert
 * would clobber the alert registration.
 */
export class LiveActivityStore {
    constructor(private readonly db: Database) {}

    /**
     * Upserts `(namespace, deviceId, sessionId)` and reports whether the
     * token or push key changed. Callers use that bit to force a reconcile
     * only for genuine registration changes.
     */
    upsert(
        namespace: string,
        deviceId: string,
        sessionId: string,
        token: string,
        pushKey: string
    ): boolean {
        return upsertLiveActivityToken(this.db, namespace, deviceId, sessionId, token, pushKey)
    }

    removeByToken(namespace: string, token: string): void {
        removeLiveActivityTokenByToken(this.db, namespace, token)
    }

    removeForDevice(namespace: string, deviceId: string, sessionId?: string): void {
        removeLiveActivityTokens(this.db, namespace, deviceId, sessionId)
    }

    removeForSession(sessionId: string): void {
        removeLiveActivityTokensForSession(this.db, sessionId)
    }

    getForSession(namespace: string, sessionId: string): StoredLiveActivityToken[] {
        return getLiveActivityTokensForSession(this.db, namespace, sessionId)
    }

    listAll(): StoredLiveActivityToken[] {
        return listLiveActivityTokens(this.db)
    }

    listForSessionAnyNamespace(sessionId: string): StoredLiveActivityToken[] {
        return listLiveActivityTokensForAnySession(this.db, sessionId)
    }

    listSessionRefs(): Array<{ namespace: string; sessionId: string }> {
        return listLiveActivitySessionRefs(this.db)
    }

    pruneOlderThan(cutoffMs: number): void {
        pruneLiveActivityTokens(this.db, cutoffMs)
    }
}
