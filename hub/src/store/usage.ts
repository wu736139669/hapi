import type { Database } from 'bun:sqlite'

export type UsageEventKind = 'delta' | 'cumulative'

export type UsageEvent = {
    sessionId: string
    sourceKey: string
    sourceSeq: number
    createdAt: number
    agent: string
    model: string | null
    kind: UsageEventKind
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
}

type UsageEventRow = {
    session_id: string
    source_key: string
    source_seq: number
    created_at: number
    agent: string
    model: string | null
    kind: UsageEventKind
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
}

function toUsageEvent(row: UsageEventRow): UsageEvent {
    return {
        sessionId: row.session_id,
        sourceKey: row.source_key,
        sourceSeq: row.source_seq,
        createdAt: row.created_at,
        agent: row.agent,
        model: row.model,
        kind: row.kind,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheCreationTokens: row.cache_creation_tokens
    }
}

export function upsertUsageEvents(db: Database, events: UsageEvent[]): void {
    if (events.length === 0) return

    db.transaction(() => {
        const statement = db.prepare(`
            INSERT INTO usage_events (
                session_id,
                source_key,
                source_seq,
                created_at,
                agent,
                model,
                kind,
                input_tokens,
                output_tokens,
                cache_read_tokens,
                cache_creation_tokens
            ) VALUES (
                @session_id,
                @source_key,
                @source_seq,
                @created_at,
                @agent,
                @model,
                @kind,
                @input_tokens,
                @output_tokens,
                @cache_read_tokens,
                @cache_creation_tokens
            )
            ON CONFLICT(session_id, source_key)
            DO UPDATE SET
                source_seq = excluded.source_seq,
                created_at = excluded.created_at,
                agent = excluded.agent,
                model = excluded.model,
                kind = excluded.kind,
                input_tokens = excluded.input_tokens,
                output_tokens = excluded.output_tokens,
                cache_read_tokens = excluded.cache_read_tokens,
                cache_creation_tokens = excluded.cache_creation_tokens
        `)

        for (const event of events) {
            statement.run({
                session_id: event.sessionId,
                source_key: event.sourceKey,
                source_seq: event.sourceSeq,
                created_at: event.createdAt,
                agent: event.agent,
                model: event.model,
                kind: event.kind,
                input_tokens: event.inputTokens,
                output_tokens: event.outputTokens,
                cache_read_tokens: event.cacheReadTokens,
                cache_creation_tokens: event.cacheCreationTokens
            })
        }
    })()
}

export function getUsageEvents(db: Database, sessionIds: string[]): UsageEvent[] {
    if (sessionIds.length === 0) return []

    const placeholders = sessionIds.map(() => '?').join(', ')
    const rows = db.prepare(`
        SELECT
            session_id,
            source_key,
            source_seq,
            created_at,
            agent,
            model,
            kind,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_creation_tokens
        FROM usage_events
        WHERE session_id IN (${placeholders})
        ORDER BY created_at ASC, source_seq ASC
    `).all(...sessionIds) as UsageEventRow[]

    return rows.map(toUsageEvent)
}

export function getMaxUsageSourceSeqBySession(db: Database, sessionIds: string[]): Map<string, number> {
    if (sessionIds.length === 0) return new Map()

    const placeholders = sessionIds.map(() => '?').join(', ')
    const rows = db.prepare(`
        SELECT session_id, MAX(source_seq) AS max_source_seq
        FROM usage_events
        WHERE session_id IN (${placeholders})
        GROUP BY session_id
    `).all(...sessionIds) as Array<{ session_id: string; max_source_seq: number | null }>

    return new Map(rows.map((row) => [row.session_id, row.max_source_seq ?? 0]))
}
