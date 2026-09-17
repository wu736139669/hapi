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
 * Parse one `message.data` JSON row from the OpenCode store. Only assistant
 * messages carry provider accounting; zero-token rows (aborted or synthetic
 * messages) are skipped so they do not inflate the request count.
 */
export function parseOpencodeAssistantUsage(raw: string): OpencodeAssistantUsage | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    const message = asRecord(parsed)
    if (!message || message.role !== 'assistant') return null
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

    const providerId = asString(message.providerID)
    const modelId = asString(message.modelID) ?? asString(asRecord(message.model)?.modelID)
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

/**
 * Every OpenCode session id present in the store's message table. Used by a
 * machine's runner to report all of its sessions (including ones whose
 * process already exited) in a single pass.
 */
export async function listOpencodeSessionIds(dbPath: string): Promise<string[]> {
    if (!existsSync(dbPath)) return []
    const { Database } = await import('bun:sqlite')
    const db = new Database(dbPath, { readonly: true })
    try {
        const rows = db.prepare('SELECT DISTINCT session_id FROM message').all() as Array<{ session_id: string }>
        return rows
            .map((row) => row.session_id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
    } finally {
        db.close()
    }
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
        const selectMessages = db.prepare('SELECT data FROM message WHERE session_id = ?')
        for (const sessionId of opencodeSessionIds) {
            const messageRows = selectMessages.all(sessionId) as Array<{ data: string }>
            const buckets = new Map<string, OpencodeUsageReportRow>()
            let messages = 0
            for (const row of messageRows) {
                const usage = parseOpencodeAssistantUsage(row.data)
                if (!usage) continue
                messages += 1
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
            }
            result.set(sessionId, { rows: Array.from(buckets.values()), messages })
        }
    } finally {
        db.close()
    }

    return result
}
