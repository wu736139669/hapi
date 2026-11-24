import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OpencodeUsageReportRow } from './usage'

/**
 * Reading and aggregating OpenCode's own token accounting.
 *
 * OpenCode stores every message in `~/.local/share/opencode/opencode.db` with
 * per-message provider counters (`tokens.input/output/reasoning/cache.*`).
 * HAPI's live pipeline only sees the final model step of a turn, so both the
 * hub's local reconciliation job and each session process (reporting its own
 * machine's store) derive the dashboard numbers from this file instead.
 *
 * OpenCode v2 moved sessions into `session_v2` and messages into
 * `session_message`. Those rows have no `role` inside `data` (the `type`
 * column carries it) and put provider/model ids under `model`. Both message
 * tables are read, with v2 taking precedence when a session appears in both:
 * older stores mirrored the same messages into both tables, so summing them
 * would double count.
 */

export type OpencodeAssistantUsage = {
    day: string
    model: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
}

export type OpencodeSessionUsage = {
    rows: OpencodeUsageReportRow[]
    messages: number
}

type MessageRow = {
    session_id: string
    data: string
    type?: string
}

type SessionAccumulation = {
    buckets: Map<string, OpencodeUsageReportRow>
    messages: number
}

/**
 * Resolve the OpenCode SQLite store. `HAPI_OPENCODE_DB` overrides the path
 * (tests, non-XDG layouts); the default follows the XDG data directory.
 */
export function resolveOpencodeDbPath(env: NodeJS.ProcessEnv = process.env): string | null {
    const override = env.HAPI_OPENCODE_DB?.trim()
    if (override) return override
    const dataHome = env.XDG_DATA_HOME?.trim()
    return join(
        dataHome && dataHome.length > 0 ? dataHome : join(homedir(), '.local', 'share'),
        'opencode',
        'opencode.db'
    )
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : 0
}

/**
 * Day bucket for a message timestamp, in the machine's local timezone. The
 * dashboard's daily buckets use the request timezone; for the default
 * (same-timezone) view these line up exactly.
 */
function localDayKey(createdAtMs: number): string {
    const date = new Date(createdAtMs)
    const year = String(date.getFullYear()).padStart(4, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

/**
 * Parse one message row's JSON payload. Only assistant messages carry
 * provider accounting; zero-token rows (aborted or synthetic messages) are
 * skipped so they do not inflate the request count.
 *
 * Legacy `message.data` has `role` plus top-level `providerID`/`modelID`.
 * OpenCode v2 `session_message.data` has neither: `messageType` is the table's
 * `type` column and the model ids live under `model`.
 */
export function parseOpencodeAssistantUsage(raw: string, messageType?: string): OpencodeAssistantUsage | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    const message = asRecord(parsed)
    if (!message) return null
    const role = asString(message.role) ?? (messageType === 'assistant' ? 'assistant' : null)
    if (role !== 'assistant') return null
    const tokens = asRecord(message.tokens)
    if (!tokens) return null
    const cache = asRecord(tokens.cache)
    const input = asCount(tokens.input)
    const output = asCount(tokens.output)
    const reasoning = asCount(tokens.reasoning)
    const cacheRead = asCount(cache?.read)
    const cacheCreation = asCount(cache?.write)
    if (input + output + reasoning + cacheRead + cacheCreation <= 0) return null
    const time = asRecord(message.time)
    const createdAt = asCount(time?.created)
    if (createdAt <= 0) return null

    const modelRecord = asRecord(message.model)
    const providerId = asString(message.providerID) ?? asString(modelRecord?.providerID)
    const modelId = asString(message.modelID) ?? asString(modelRecord?.modelID) ?? asString(modelRecord?.id)
    const model = providerId && modelId
        ? `${providerId}/${modelId}`
        : modelId ?? 'unknown'

    return {
        day: localDayKey(createdAt),
        model,
        // The HAPI ledger stores input inclusive of cache reads/writes
        // (hapi.usage.v1) and folds reasoning into output, matching how the
        // dashboard tallies input/output downstream.
        inputTokens: input + cacheRead + cacheCreation,
        outputTokens: output + reasoning,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation
    }
}

/** Table names that hold message payloads, in precedence order (v2 first). */
const MESSAGE_TABLES = ['session_message', 'message'] as const

function availableMessageTables(db: {
    prepare: (sql: string) => { all: () => unknown }
}): Set<string> {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    return new Set(rows.map((row) => row.name))
}

/**
 * Every OpenCode session id present in the store's message tables. Used by a
 * machine's runner to report all of its sessions (including ones whose
 * process already exited) in a single pass.
 */
export async function listOpencodeSessionIds(dbPath: string): Promise<string[]> {
    if (!existsSync(dbPath)) return []
    const { Database } = await import('bun:sqlite')
    const db = new Database(dbPath, { readonly: true })
    try {
        const tables = availableMessageTables(db)
        const ids = new Set<string>()
        for (const table of MESSAGE_TABLES) {
            if (!tables.has(table)) continue
            const rows = db.prepare(`SELECT DISTINCT session_id FROM ${table}`).all() as Array<{ session_id: string }>
            for (const row of rows) {
                if (typeof row.session_id === 'string' && row.session_id.length > 0) ids.add(row.session_id)
            }
        }
        return Array.from(ids)
    } finally {
        db.close()
    }
}

/** Fold one message row's token counters into its (day, model) bucket. */
function accumulateOpencodeUsage(
    buckets: Map<string, OpencodeUsageReportRow>,
    data: string,
    messageType?: string
): boolean {
    const usage = parseOpencodeAssistantUsage(data, messageType)
    if (!usage) return false
    const key = `${usage.day}|${usage.model}`
    const bucket = buckets.get(key) ?? {
        day: usage.day,
        model: usage.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        requests: 0
    }
    bucket.inputTokens += usage.inputTokens
    bucket.outputTokens += usage.outputTokens
    bucket.cacheReadTokens += usage.cacheReadTokens
    bucket.cacheCreationTokens += usage.cacheCreationTokens
    bucket.requests += 1
    buckets.set(key, bucket)
    return true
}

function accumulateRow(
    target: Map<string, SessionAccumulation>,
    sessionId: string,
    data: string,
    messageType?: string
): void {
    const entry = target.get(sessionId) ?? { buckets: new Map<string, OpencodeUsageReportRow>(), messages: 0 }
    if (accumulateOpencodeUsage(entry.buckets, data, messageType)) entry.messages += 1
    target.set(sessionId, entry)
}

/** v2 mirrors older sessions; only fall back to legacy rows it did not cover. */
function preferredUsage(
    v2: SessionAccumulation | undefined,
    legacy: SessionAccumulation | undefined
): SessionAccumulation | undefined {
    if (v2 && v2.messages > 0) return v2
    if (legacy && legacy.messages > 0) return legacy
    return v2 ?? legacy
}

function toSessionUsage(entry: SessionAccumulation | undefined): OpencodeSessionUsage {
    return entry && entry.messages > 0
        ? { rows: Array.from(entry.buckets.values()), messages: entry.messages }
        : { rows: [], messages: 0 }
}

/**
 * Aggregate absolute per-(day, model) totals for the given OpenCode session
 * ids. Missing database or unknown session ids yield empty entries, so
 * callers can always distinguish "no usage" from "not reconciled yet".
 *
 * `bun:sqlite` is imported lazily because the CLI test runner (vitest under
 * node) imports this module transitively without Bun's built-ins.
 */
export async function readOpencodeUsageForSessions(
    dbPath: string,
    opencodeSessionIds: string[]
): Promise<Map<string, OpencodeSessionUsage>> {
    const result = new Map<string, OpencodeSessionUsage>()
    for (const id of opencodeSessionIds) {
        result.set(id, { rows: [], messages: 0 })
    }
    if (opencodeSessionIds.length === 0 || !existsSync(dbPath)) return result

    const { Database } = await import('bun:sqlite')
    const db = new Database(dbPath, { readonly: true })
    try {
        const tables = availableMessageTables(db)
        const v2 = new Map<string, SessionAccumulation>()
        const legacy = new Map<string, SessionAccumulation>()
        if (tables.has('session_message')) {
            const select = db.prepare('SELECT session_id, type, data FROM session_message WHERE session_id = ?')
            for (const sessionId of opencodeSessionIds) {
                for (const row of select.all(sessionId) as MessageRow[]) {
                    accumulateRow(v2, row.session_id, row.data, row.type)
                }
            }
        }
        if (tables.has('message')) {
            const select = db.prepare('SELECT session_id, data FROM message WHERE session_id = ?')
            for (const sessionId of opencodeSessionIds) {
                for (const row of select.all(sessionId) as MessageRow[]) {
                    accumulateRow(legacy, row.session_id, row.data)
                }
            }
        }
        for (const sessionId of opencodeSessionIds) {
            result.set(sessionId, toSessionUsage(preferredUsage(v2.get(sessionId), legacy.get(sessionId))))
        }
    } finally {
        db.close()
    }

    return result
}

/**
 * Like `readOpencodeUsageForSessions` but for every session present in the
 * store (the machine-level runner path). Reads each message table in a single
 * sequential pass: per-session index queries translate into one scattered
 * page fetch per message across the multi-GB store, while a table scan reads
 * the same pages in storage order.
 */
export async function readOpencodeUsageForAllSessions(
    dbPath: string
): Promise<Map<string, OpencodeSessionUsage>> {
    const result = new Map<string, OpencodeSessionUsage>()
    if (!existsSync(dbPath)) return result

    const { Database } = await import('bun:sqlite')
    const db = new Database(dbPath, { readonly: true })
    try {
        const tables = availableMessageTables(db)
        const v2 = new Map<string, SessionAccumulation>()
        const legacy = new Map<string, SessionAccumulation>()
        if (tables.has('session_message')) {
            const rows = db.prepare('SELECT session_id, type, data FROM session_message').all() as MessageRow[]
            for (const row of rows) {
                accumulateRow(v2, row.session_id, row.data, row.type)
            }
        }
        if (tables.has('message')) {
            const rows = db.prepare('SELECT session_id, data FROM message').all() as MessageRow[]
            for (const row of rows) {
                // Mirrored legacy rows describe the same requests as v2 rows.
                if ((v2.get(row.session_id)?.messages ?? 0) > 0) continue
                accumulateRow(legacy, row.session_id, row.data)
            }
        }
        const ids = new Set<string>([...v2.keys(), ...legacy.keys()])
        for (const sessionId of ids) {
            result.set(sessionId, toSessionUsage(preferredUsage(v2.get(sessionId), legacy.get(sessionId))))
        }
    } finally {
        db.close()
    }

    return result
}
