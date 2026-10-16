import { readFileSync } from 'node:fs'
import type { CommandDefinition } from './types'

/**
 * Internal command: aggregate OpenCode token usage.
 *
 * The hub and the runner spawn `hapi usage-scan` as a child process so the
 * synchronous bun:sqlite reads over the multi-GB OpenCode store never block
 * their event loops (a cold scan used to freeze the hub for a minute or
 * more). The request arrives as JSON on stdin, the result leaves as JSON on
 * stdout: `{ dbPath, sessionIds }` for known sessions, or
 * `{ dbPath, listAll: true }` to scan every session found in the store.
 */

export type UsageScanRequest = {
    dbPath: string
    sessionIds?: string[]
    listAll?: boolean
}

function readStdin(): string {
    // fd 0 works for both pipe and file-backed stdin; Bun's async iteration
    // over a file-backed stdin yields nothing.
    return readFileSync(0, 'utf8')
}

export function parseUsageScanRequest(raw: string): UsageScanRequest {
    const parsed = JSON.parse(raw) as { dbPath?: unknown; sessionIds?: unknown; listAll?: unknown }
    if (typeof parsed.dbPath !== 'string') {
        throw new Error('usage-scan expects { dbPath: string, sessionIds?: string[], listAll?: boolean } on stdin')
    }
    if (parsed.listAll === true) {
        return { dbPath: parsed.dbPath, listAll: true }
    }
    if (!Array.isArray(parsed.sessionIds)) {
        throw new Error('usage-scan expects sessionIds or listAll: true on stdin')
    }
    const sessionIds = parsed.sessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    return { dbPath: parsed.dbPath, sessionIds }
}

/** Payload shape the hub/runner parse (see hub/src/sync/usageReconciliation.ts). */
export async function runUsageScan(request: UsageScanRequest): Promise<{ results: Record<string, { rows: unknown[]; messages: number }> }> {
    const { readOpencodeUsageForAllSessions, readOpencodeUsageForSessions } = await import('@hapi/protocol/opencodeUsage')
    const usage = request.listAll === true
        ? await readOpencodeUsageForAllSessions(request.dbPath)
        : await readOpencodeUsageForSessions(request.dbPath, request.sessionIds ?? [])
    const results: Record<string, { rows: unknown[]; messages: number }> = {}
    for (const [sessionId, entry] of usage) {
        results[sessionId] = { rows: entry.rows, messages: entry.messages }
    }
    return { results }
}

export const usageScanCommand: CommandDefinition = {
    name: 'usage-scan',
    requiresRuntimeAssets: false,
    run: async () => {
        const request = parseUsageScanRequest(readStdin())
        process.stdout.write(JSON.stringify(await runUsageScan(request)))
    }
}
