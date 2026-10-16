import { listOpencodeSessionIds, readOpencodeUsageForSessions, resolveOpencodeDbPath } from '@hapi/protocol/opencodeUsage'
import type { OpencodeUsageReportRow, OpencodeUsageSessionReport } from '@hapi/protocol/usage'
import { logger } from '@/ui/logger'

/**
 * Machine-level OpenCode usage reconciliation.
 *
 * The hub can only read its own OpenCode store, so each runner scans its
 * machine's store and reports absolute per-(day, model) snapshots for every
 * session it finds there — including sessions whose process already exited.
 * The hub maps the OpenCode session ids back to HAPI sessions and replaces
 * their reconciliation rows, which makes repeated or concurrent reports
 * idempotent (see hub/src/sync/usageReconciliation.ts).
 *
 * The scan runs in a spawned `hapi usage-scan` child process: the OpenCode
 * store is multi-GB in practice and `bun:sqlite` is synchronous, so an
 * in-process scan would stall this runner's event loop — machine RPCs
 * (spawn, model listing) queue behind it and can time out.
 *
 * The live chat pipeline is not involved at all — a report never becomes a
 * timeline message.
 */

const SCAN_INTERVAL_MS = 30 * 60 * 1000
const INITIAL_DELAY_MS = 20_000
const SCAN_TIMEOUT_MS = 2 * 60 * 1000

export type OpencodeUsageScannerOptions = {
    /** Best-effort delivery; the next scan re-sends on failure. */
    report: (sessions: OpencodeUsageSessionReport[]) => void
    /** Override for tests; defaults to the XDG OpenCode store path. */
    dbPath?: string | null
    intervalMs?: number
    initialDelayMs?: number
}

export type OpencodeUsageScanner = {
    /** Idempotent. */
    stop: () => void
    /** Run one scan immediately (used by tests). */
    runNow: () => void
}

type ScannedUsage = Map<string, { rows: OpencodeUsageReportRow[]; messages: number }>

async function spawnUsageScan(request: { dbPath: string; listAll: true }): Promise<ScannedUsage | null> {
    if (typeof Bun === 'undefined') return null
    const executable = process.env.HAPI_CLI_EXECUTABLE?.trim() || process.execPath
    if (!executable) return null
    try {
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
            const parsed = JSON.parse(stdout) as { results?: unknown }
            const results = parsed.results
            if (results === null || typeof results !== 'object' || Array.isArray(results)) return null
            const usage: ScannedUsage = new Map()
            for (const [sessionId, value] of Object.entries(results as Record<string, unknown>)) {
                const entry = value as { rows?: unknown; messages?: unknown } | null
                if (!entry || typeof entry !== 'object' || !Array.isArray(entry.rows)) return null
                usage.set(sessionId, {
                    rows: entry.rows as OpencodeUsageReportRow[],
                    messages: typeof entry.messages === 'number' ? entry.messages : entry.rows.length
                })
            }
            return usage
        } finally {
            clearTimeout(timer)
        }
    } catch {
        return null
    }
}

/** Probe once whether the current executable can actually run `usage-scan`. */
let cliScanAvailablePromise: Promise<boolean> | null = null

function cliScanAvailable(): Promise<boolean> {
    cliScanAvailablePromise ??= (async () => {
        const probe = await spawnUsageScan({ dbPath: '', listAll: true })
        return probe !== null
    })()
    return cliScanAvailablePromise
}

async function scanOpencodeStore(dbPath: string): Promise<ScannedUsage> {
    if (await cliScanAvailable()) {
        const scanned = await spawnUsageScan({ dbPath, listAll: true })
        if (scanned) return scanned
        throw new Error('opencode usage scan failed')
    }
    // Dev/test fallback (no hapi binary to spawn): read in-process. This is
    // deliberately not used in production — the multi-GB scan must never run
    // on this process's event loop.
    const opencodeSessionIds = await listOpencodeSessionIds(dbPath)
    if (opencodeSessionIds.length === 0) return new Map()
    return await readOpencodeUsageForSessions(dbPath, opencodeSessionIds)
}

/** Collect snapshot rows for every session present in the OpenCode store. */
export async function collectOpencodeUsageReports(dbPath: string): Promise<OpencodeUsageSessionReport[]> {
    const usageBySession = await scanOpencodeStore(dbPath)
    const reports: OpencodeUsageSessionReport[] = []
    for (const [opencodeSessionId, usage] of usageBySession) {
        if (usage.rows.length === 0) continue
        reports.push({ opencodeSessionId, rows: usage.rows })
    }
    return reports
}

export function startOpencodeUsageScanner(opts: OpencodeUsageScannerOptions): OpencodeUsageScanner {
    let stopped = false
    const run = (): void => {
        if (stopped) return
        const dbPath = opts.dbPath === undefined ? resolveOpencodeDbPath() : opts.dbPath
        if (!dbPath) return
        void collectOpencodeUsageReports(dbPath)
            .then((reports) => {
                if (stopped || reports.length === 0) return
                opts.report(reports)
            })
            .catch((error) => {
                logger.debug('[opencode-usage] machine reconciliation report failed', error)
            })
    }

    const initial = setTimeout(run, opts.initialDelayMs ?? INITIAL_DELAY_MS)
    const interval = setInterval(run, opts.intervalMs ?? SCAN_INTERVAL_MS)
    initial.unref?.()
    interval.unref?.()

    return {
        stop: () => {
            stopped = true
            clearTimeout(initial)
            clearInterval(interval)
        },
        runNow: run
    }
}
