import { listOpencodeSessionIds, readOpencodeUsageForSessions, resolveOpencodeDbPath } from '@hapi/protocol/opencodeUsage'
import type { OpencodeUsageSessionReport } from '@hapi/protocol/usage'
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
 * The live chat pipeline is not involved at all — a report never becomes a
 * timeline message.
 */

const SCAN_INTERVAL_MS = 30 * 60 * 1000
const INITIAL_DELAY_MS = 20_000

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

/** Collect snapshot rows for every session present in the OpenCode store. */
export async function collectOpencodeUsageReports(dbPath: string): Promise<OpencodeUsageSessionReport[]> {
    const opencodeSessionIds = await listOpencodeSessionIds(dbPath)
    if (opencodeSessionIds.length === 0) return []
    const usageBySession = await readOpencodeUsageForSessions(dbPath, opencodeSessionIds)
    const reports: OpencodeUsageSessionReport[] = []
    for (const opencodeSessionId of opencodeSessionIds) {
        const usage = usageBySession.get(opencodeSessionId)
        if (!usage || usage.rows.length === 0) continue
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
