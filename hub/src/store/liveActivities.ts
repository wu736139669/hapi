import type { Database } from 'bun:sqlite'

import type { StoredLiveActivityToken } from './types'

type DbLiveActivityTokenRow = {
    id: number
    namespace: string
    device_id: string
    session_id: string
    token: string
    push_key: string
    created_at: number
    updated_at: number
}

function toStoredLiveActivityToken(row: DbLiveActivityTokenRow): StoredLiveActivityToken {
    return {
        id: row.id,
        namespace: row.namespace,
        deviceId: row.device_id,
        sessionId: row.session_id,
        token: row.token,
        pushKey: row.push_key,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

/**
 * Upserts one device's Live Activity token for a session and returns whether
 * the token/key actually changed. Registration calls use the changed bit to
 * decide whether to force a reconciliation push; a foreground re-registration
 * with the same token must not cause a push.
 */
export function upsertLiveActivityToken(
    db: Database,
    namespace: string,
    deviceId: string,
    sessionId: string,
    token: string,
    pushKey: string
): boolean {
    const existing = db.prepare(`
        SELECT token, push_key FROM live_activity_tokens
        WHERE namespace = ? AND device_id = ? AND session_id = ?
    `).get(namespace, deviceId, sessionId) as { token: string; push_key: string } | undefined
    const changed = !existing || existing.token !== token || existing.push_key !== pushKey
    const now = Date.now()
    db.prepare(`
        INSERT INTO live_activity_tokens (
            namespace, device_id, session_id, token, push_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(namespace, device_id, session_id)
        DO UPDATE SET
            token = excluded.token,
            push_key = excluded.push_key,
            updated_at = excluded.updated_at
    `).run(namespace, deviceId, sessionId, token, pushKey, now, now)
    return changed
}

export function removeLiveActivityTokenByToken(
    db: Database,
    namespace: string,
    token: string
): void {
    db.prepare(`
        DELETE FROM live_activity_tokens WHERE namespace = ? AND token = ?
    `).run(namespace, token)
}

export function removeLiveActivityTokens(
    db: Database,
    namespace: string,
    deviceId: string,
    sessionId?: string
): void {
    if (sessionId) {
        db.prepare(`
            DELETE FROM live_activity_tokens
            WHERE namespace = ? AND device_id = ? AND session_id = ?
        `).run(namespace, deviceId, sessionId)
        return
    }
    db.prepare(`
        DELETE FROM live_activity_tokens WHERE namespace = ? AND device_id = ?
    `).run(namespace, deviceId)
}

export function getLiveActivityTokensForSession(
    db: Database,
    namespace: string,
    sessionId: string
): StoredLiveActivityToken[] {
    const rows = db.prepare(`
        SELECT * FROM live_activity_tokens
        WHERE namespace = ? AND session_id = ?
        ORDER BY updated_at DESC
    `).all(namespace, sessionId) as DbLiveActivityTokenRow[]
    return rows.map(toStoredLiveActivityToken)
}

export function listLiveActivityTokens(db: Database): StoredLiveActivityToken[] {
    const rows = db.prepare(`
        SELECT * FROM live_activity_tokens ORDER BY updated_at DESC
    `).all() as DbLiveActivityTokenRow[]
    return rows.map(toStoredLiveActivityToken)
}

/**
 * Namespace-agnostic lookup for `session-removed`, whose event may not carry
 * a namespace. Session ids are UUIDs, so cross-namespace matches cannot
 * collide in practice.
 */
export function listLiveActivityTokensForAnySession(
    db: Database,
    sessionId: string
): StoredLiveActivityToken[] {
    const rows = db.prepare(`
        SELECT * FROM live_activity_tokens WHERE session_id = ? ORDER BY updated_at DESC
    `).all(sessionId) as DbLiveActivityTokenRow[]
    return rows.map(toStoredLiveActivityToken)
}

/**
 * Session ids with at least one registered activity token. Used by the boot
 * reconcile; the namespace travels with the row, so the caller can resolve
 * the session from the cache.
 */
export function listLiveActivitySessionRefs(
    db: Database
): Array<{ namespace: string; sessionId: string }> {
    const rows = db.prepare(`
        SELECT DISTINCT namespace, session_id FROM live_activity_tokens
    `).all() as Array<{ namespace: string; session_id: string }>
    return rows.map((row) => ({ namespace: row.namespace, sessionId: row.session_id }))
}

/**
 * Namespace-agnostic cleanup for `session-removed`, whose event may not carry
 * a namespace. Session ids are UUIDs, so deleting by id alone is safe.
 */
export function removeLiveActivityTokensForSession(db: Database, sessionId: string): void {
    db.prepare('DELETE FROM live_activity_tokens WHERE session_id = ?').run(sessionId)
}

export function pruneLiveActivityTokens(db: Database, olderThanMs: number): void {
    db.prepare('DELETE FROM live_activity_tokens WHERE updated_at < ?').run(olderThanMs)
}
