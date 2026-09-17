import { existsSync } from 'node:fs'
import { readOpencodeUsageForSessions, resolveOpencodeDbPath } from '@hapi/protocol/opencodeUsage'
import type { Store } from '../store'
import type { ReconciledUsageRow } from '../store/usage'

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
 */

const RECONCILE_INTERVAL_MS = 30 * 60 * 1000
const INITIAL_DELAY_MS = 15_000

export type UsageReconciliationResult = {
    dbPath: string | null
    sessions: number
    rows: number
    messages: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Re-read every known OpenCode session from the local store and refresh snapshots. */
export async function reconcileOpencodeUsage(
    store: Store,
    options?: { dbPath?: string | null; now?: number }
): Promise<UsageReconciliationResult> {
    const dbPath = options?.dbPath === undefined ? resolveOpencodeDbPath() : options.dbPath
    const now = options?.now ?? Date.now()
    if (!dbPath || !existsSync(dbPath)) {
        return { dbPath: dbPath ?? null, sessions: 0, rows: 0, messages: 0 }
    }

    const targets: Array<{ sessionId: string; namespace: string; opencodeSessionId: string }> = []
    for (const session of store.sessions.getSessions()) {
        const opencodeSessionId = asString(asRecord(session.metadata)?.opencodeSessionId)
        if (!opencodeSessionId) continue
        targets.push({ sessionId: session.id, namespace: session.namespace, opencodeSessionId })
    }

    const usageBySession = await readOpencodeUsageForSessions(dbPath, targets.map((target) => target.opencodeSessionId))
    let sessionsTouched = 0
    let rowsTotal = 0
    let messagesTotal = 0
    for (const target of targets) {
        const usage = usageBySession.get(target.opencodeSessionId) ?? { rows: [], messages: 0 }
        // No local messages means this session's OpenCode store lives on
        // another machine (its own process reports the rows) — leave the
        // existing snapshot alone instead of wiping it with an empty one.
        if (usage.messages === 0) continue
        const rows: ReconciledUsageRow[] = usage.rows.map((row) => ({
            sessionId: target.sessionId,
            agent: 'opencode',
            ...row
        }))
        store.usage.replaceReconciled(target.sessionId, target.namespace, rows, now)
        sessionsTouched += 1
        rowsTotal += rows.length
        messagesTotal += usage.messages
    }

    return { dbPath, sessions: sessionsTouched, rows: rowsTotal, messages: messagesTotal }
}

export type UsageReconciliationJob = {
    /** Idempotent. */
    stop: () => void
    /** Run one reconciliation pass immediately (used by tests). */
    runNow: () => void
}

/** Schedule periodic reconciliation while the hub is running. */
export function startOpencodeUsageReconciliation(
    store: Store,
    options?: { intervalMs?: number; initialDelayMs?: number }
): UsageReconciliationJob {
    let stopped = false
    const run = (): void => {
        if (stopped) return
        void reconcileOpencodeUsage(store)
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
    }

    const initial = setTimeout(run, options?.initialDelayMs ?? INITIAL_DELAY_MS)
    const interval = setInterval(run, options?.intervalMs ?? RECONCILE_INTERVAL_MS)
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
