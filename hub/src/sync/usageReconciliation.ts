import { existsSync } from 'node:fs'
import {
    readOpencodeUsageForSessions,
    resolveOpencodeDbPath,
    type OpencodeSessionUsage
} from '@hapi/protocol/opencodeUsage'
import type { Store } from '../store'
import type { ReconciledUsageRow } from '../store/usage'
import type { UsageSource } from '../store/usageSources'

/**
 * Offline usage reconciliation for OpenCode sessions.
 *
 * The live pipeline records usage from the agent's prompt responses. OpenCode
 * only reports the *final* model step of a turn there, so every tool-loop step
 * (usually the bulk of the tokens) is missing from the dashboard. Instead of
 * changing the live stream — which previously leaked cumulative counters into
 * the chat/status UI — this job periodically reads OpenCode's own SQLite store
 * and writes absolute per-(day, model) snapshots into `usage_reconciliation`.
 * `getUsageSummary` prefers those snapshots for reconciled sessions and never
 * mixes them with the live events of the same session, so the job is
 * idempotent and can re-run at any cadence without double counting.
 *
 * This hub-side pass only covers sessions whose OpenCode store lives on the
 * hub machine. Every other machine's runner reports the same row shape over
 * the `opencode-usage-report` socket event (see `@hapi/protocol/opencodeUsage`
 * and cli/src/runner/opencodeUsageScanner.ts).
 *
 * The scan itself runs in a spawned `hapi usage-scan` child process: the
 * OpenCode store is multi-GB in practice, and `bun:sqlite` is synchronous, so
 * an in-process scan would block the hub's event loop for the whole read
 * (observed: 88s freezes under memory pressure). The hub only ever applies the
 * small aggregated result.
 */

const FALLBACK_INTERVAL_MS = 24 * 60 * 60 * 1000
const INITIAL_DELAY_MS = 60_000
const REFRESH_MAX_AGE_MS = 5 * 60 * 1000
const SCAN_TIMEOUT_MS = 2 * 60 * 1000

export type UsageReconciliationResult = {
    dbPath: string | null
    sessions: number
    rows: number
    messages: number
}

export type OpencodeUsageScanRequest = {
    dbPath: string
    sessionIds: string[]
}

export type OpencodeUsageScan = (
    request: OpencodeUsageScanRequest
) => Promise<Map<string, OpencodeSessionUsage>>

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseScanOutput(stdout: string): Map<string, OpencodeSessionUsage> | null {
    const parsed = JSON.parse(stdout) as { results?: unknown }
    const results = asRecord(parsed.results)
    if (!results) return null
    const usage = new Map<string, OpencodeSessionUsage>()
    for (const [sessionId, value] of Object.entries(results)) {
        const entry = asRecord(value)
        if (!entry || !Array.isArray(entry.rows) || typeof entry.messages !== 'number') return null
        usage.set(sessionId, { rows: entry.rows as OpencodeSessionUsage['rows'], messages: entry.messages })
    }
    return usage
}

async function spawnUsageScanCli(request: OpencodeUsageScanRequest): Promise<string | null> {
    const executable = process.env.HAPI_CLI_EXECUTABLE?.trim() || process.execPath
    if (!executable) return null
    const proc = Bun.spawn({
        cmd: [executable, 'usage-scan'],
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'ignore'
    })
    const timer = setTimeout(() => {
        try {
            proc.kill()
        } catch {
        }
    }, SCAN_TIMEOUT_MS)
    try {
        proc.stdin.write(JSON.stringify(request))
        proc.stdin.end()
        const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
        if (exitCode !== 0 || stdout.trim().length === 0) return null
        return stdout
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

/** Probe once whether the current executable can actually run `usage-scan`. */
let scanModePromise: Promise<'cli' | 'in-process'> | null = null

function resolveScanMode(): Promise<'cli' | 'in-process'> {
    scanModePromise ??= (async () => {
        try {
            // Empty request: the CLI answers immediately, while a non-hapi
            // executable (e.g. `bun` under tests/dev) fails fast.
            const stdout = await spawnUsageScanCli({ dbPath: '', sessionIds: [] })
            return stdout !== null && parseScanOutput(stdout) !== null ? 'cli' : 'in-process'
        } catch {
            return 'in-process'
        }
    })()
    return scanModePromise
}

/**
 * Default scan: a `hapi usage-scan` child process when available. A transient
 * child failure is reported as an error instead of falling back to an
 * in-process read — the whole point is to keep the read off this process.
 * Only when the executable cannot run the command at all (dev/test) do we
 * read in-process; those environments are not the multi-GB-store case.
 */
async function defaultOpencodeUsageScan(
    request: OpencodeUsageScanRequest
): Promise<Map<string, OpencodeSessionUsage>> {
    if (await resolveScanMode() === 'cli') {
        const stdout = await spawnUsageScanCli(request)
        const usage = stdout === null ? null : parseScanOutput(stdout)
        if (usage) return usage
        throw new Error('opencode usage scan failed')
    }
    return await readOpencodeUsageForSessions(request.dbPath, request.sessionIds)
}

/** Re-read every known OpenCode session from the local store and refresh snapshots. */
export async function reconcileOpencodeUsage(
    store: Store,
    options?: { dbPath?: string | null; now?: number; scan?: OpencodeUsageScan }
): Promise<UsageReconciliationResult> {
    const dbPath = options?.dbPath === undefined ? resolveOpencodeDbPath() : options.dbPath
    const now = options?.now ?? Date.now()
    if (!dbPath || !existsSync(dbPath)) {
        return { dbPath: dbPath ?? null, sessions: 0, rows: 0, messages: 0 }
    }

    const targets = new Map<string, UsageSource>()
    for (const session of store.sessions.getSessions()) {
        store.usage.rememberSessionSources(session)
        const opencodeSessionId = asString(asRecord(session.metadata)?.opencodeSessionId)
        if (!opencodeSessionId) continue
        const source = store.usage.getSources(session.namespace).find((entry) => entry.agent === 'opencode' && entry.sessionId === session.id && entry.nativeSessionId === opencodeSessionId)
        if (source) targets.set(`${source.namespace}|${source.machineId}|${source.nativeSessionId}`, source)
    }
    for (const source of store.usage.getSources()) {
        if (source.agent !== 'opencode') continue
        const key = `${source.namespace}|${source.machineId}|${source.nativeSessionId}`
        if (!targets.has(key)) targets.set(key, source)
    }

    const scan = options?.scan ?? defaultOpencodeUsageScan
    const usageBySession = await scan({
        dbPath,
        sessionIds: [...targets.values()].map((target) => target.nativeSessionId)
    })
    let sessionsTouched = 0
    let rowsTotal = 0
    let messagesTotal = 0
    for (const target of targets.values()) {
        const usage = usageBySession.get(target.nativeSessionId) ?? { rows: [], messages: 0 }
        // No local messages means this session's OpenCode store lives on
        // another machine (its own process reports the rows) — leave the
        // existing snapshot alone instead of wiping it with an empty one.
        if (usage.messages === 0) continue
        const rows: ReconciledUsageRow[] = usage.rows.map((row) => ({
            sessionId: target.sessionId,
            agent: 'opencode',
            ...row
        }))
        store.usage.reconcileSource(target, rows, now)
        sessionsTouched += 1
        rowsTotal += rows.length
        messagesTotal += usage.messages
    }

    return { dbPath, sessions: sessionsTouched, rows: rowsTotal, messages: messagesTotal }
}

export type UsageReconciliationJob = {
    /** Idempotent. */
    stop: () => void
    /** Run one reconciliation pass now (concurrent callers share the pass). */
    runNow: () => Promise<void>
    /** Run a pass unless the last one finished within `maxAgeMs`. */
    refresh: (maxAgeMs?: number) => Promise<void>
}

/**
 * Schedule reconciliation while the hub is running.
 *
 * The dashboard refreshes on demand (`refresh`, triggered by the usage page),
 * so the timer is only a gentle safety net — one pass shortly after startup
 * and a daily fallback. The pass itself never blocks the hub (child process).
 */
export function startOpencodeUsageReconciliation(
    store: Store,
    options?: { intervalMs?: number; initialDelayMs?: number }
): UsageReconciliationJob {
    let stopped = false
    let lastCompletedAt = 0
    let inFlight: Promise<void> | null = null

    const runPass = (): Promise<void> => {
        if (stopped) return Promise.resolve()
        const pass = reconcileOpencodeUsage(store)
            .then((result) => {
                if (result.messages > 0) {
                    console.log(
                        `[UsageReconciliation] opencode: ${result.messages} messages → ${result.rows} day/model rows across ${result.sessions} sessions`
                    )
                }
            })
            .catch((error) => {
                console.warn('[UsageReconciliation] failed:', error instanceof Error ? error.message : error)
            })
            .finally(() => {
                lastCompletedAt = Date.now()
                inFlight = null
            })
        inFlight = pass
        return pass
    }

    const runNow = (): Promise<void> => inFlight ?? runPass()

    const refresh = async (maxAgeMs?: number): Promise<void> => {
        const maxAge = typeof maxAgeMs === 'number' && Number.isFinite(maxAgeMs) ? maxAgeMs : REFRESH_MAX_AGE_MS
        if (Date.now() - lastCompletedAt < maxAge) return
        await runNow()
    }

    const initial = setTimeout(() => void runNow(), options?.initialDelayMs ?? INITIAL_DELAY_MS)
    const interval = setInterval(() => void runNow(), options?.intervalMs ?? FALLBACK_INTERVAL_MS)
    initial.unref?.()
    interval.unref?.()

    return {
        stop: () => {
            stopped = true
            clearTimeout(initial)
            clearInterval(interval)
        },
        runNow,
        refresh
    }
}
