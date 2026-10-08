import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import type { StoredSession } from './types'

export type UsageSource = {
    namespace: string
    machineId: string
    agent: string
    nativeSessionId: string
    sessionId: string
}

export function usageSourceLedgerId(source: Omit<UsageSource, 'sessionId'>): string {
    return `usage-source:${createHash('sha256')
        .update(JSON.stringify([source.namespace, source.machineId, source.agent, source.nativeSessionId]))
        .digest('hex')}`
}

export function rememberUsageSource(db: Database, source: UsageSource): void {
    db.prepare(`INSERT OR IGNORE INTO usage_session_sources
        (namespace, machine_id, agent, native_session_id, session_id) VALUES (?, ?, ?, ?, ?)`)
        .run(source.namespace, source.machineId, source.agent, source.nativeSessionId, source.sessionId)
    if (source.machineId) {
        // Replace an incomplete binding once the owning machine is known.
        db.prepare(`DELETE FROM usage_session_sources WHERE namespace = ? AND machine_id = ''
            AND agent = ? AND native_session_id = ? AND session_id = ?`)
            .run(source.namespace, source.agent, source.nativeSessionId, source.sessionId)
    }
}

export function rememberSessionUsageSources(db: Database, session: StoredSession): void {
    const metadata = session.metadata
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return
    const data = metadata as Record<string, unknown>
    const machineId = typeof data.machineId === 'string' ? data.machineId : session.machineId ?? ''
    for (const [agent, key] of [['opencode', 'opencodeSessionId'], ['codex', 'codexSessionId'], ['claude', 'claudeSessionId'], ['dsh', 'dshSessionId']] as const) {
        const nativeSessionId = data[key]
        if (typeof nativeSessionId !== 'string' || !nativeSessionId) continue
        rememberUsageSource(db, { namespace: session.namespace, machineId, agent, nativeSessionId, sessionId: session.id })
    }
}

export function getUsageSources(db: Database, namespace?: string, machineId?: string): UsageSource[] {
    const clauses: string[] = []
    const params: string[] = []
    if (namespace !== undefined) { clauses.push('namespace = ?'); params.push(namespace) }
    if (machineId !== undefined) { clauses.push('machine_id = ?'); params.push(machineId) }
    return db.prepare(`SELECT namespace, machine_id AS machineId, agent,
        native_session_id AS nativeSessionId, session_id AS sessionId
        FROM usage_session_sources ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY namespace, machine_id, agent, native_session_id, session_id`)
        .all(...params) as UsageSource[]
}
