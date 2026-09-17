import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOpencodeAssistantUsage, resolveOpencodeDbPath } from '@hapi/protocol/opencodeUsage'
import { Store } from '../store'
import { reconcileOpencodeUsage } from './usageReconciliation'
import { getUsageSummary } from './usageService'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

function createOpencodeStore(messages: Array<{ id: string; sessionId: string; data: unknown }>): string {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-opencode-usage-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'opencode.db')
    const db = new Database(dbPath, { create: true })
    db.exec(`
        CREATE TABLE message (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            time_created INTEGER NOT NULL,
            time_updated INTEGER NOT NULL,
            data TEXT NOT NULL
        )
    `)
    const insert = db.prepare(
        'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)'
    )
    for (const message of messages) {
        const created = (message.data as { time?: { created?: number } }).time?.created ?? 0
        insert.run(message.id, message.sessionId, created, created, JSON.stringify(message.data))
    }
    db.close()
    return dbPath
}

describe('usage reconciliation', () => {
    it('snapshots OpenCode per-day totals and stays idempotent', async () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'opencode-reconcile-test',
            { path: '/tmp', host: 'test', flavor: 'opencode', opencodeSessionId: 'ses_reconcile' },
            null,
            'default',
            'opencode-go/deepseek-v4.1-flash'
        )

        const dbPath = createOpencodeStore([
            {
                id: 'msg-1',
                sessionId: 'ses_reconcile',
                data: {
                    role: 'assistant',
                    providerID: 'opencode-go',
                    modelID: 'deepseek-v4.1-flash',
                    time: { created: Date.parse('2026-09-17T10:00:00') },
                    tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 900, write: 50 } }
                }
            },
            {
                id: 'msg-2',
                sessionId: 'ses_reconcile',
                data: {
                    role: 'assistant',
                    providerID: 'opencode-go',
                    modelID: 'deepseek-v4.1-flash',
                    time: { created: Date.parse('2026-09-17T10:05:00') },
                    tokens: { input: 200, output: 20, reasoning: 0, cache: { read: 800, write: 0 } }
                }
            },
            {
                // Zero-token synthetic rows must not count as requests.
                id: 'msg-3',
                sessionId: 'ses_reconcile',
                data: {
                    role: 'assistant',
                    time: { created: Date.parse('2026-09-17T10:06:00') },
                    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
                }
            },
            {
                // Sessions without a HAPI row are ignored entirely.
                id: 'msg-4',
                sessionId: 'ses_other',
                data: {
                    role: 'assistant',
                    time: { created: Date.parse('2026-09-17T10:07:00') },
                    tokens: { input: 999, output: 99 }
                }
            }
        ])

        const first = await reconcileOpencodeUsage(store, { dbPath })
        expect(first.messages).toBe(2)
        expect(first.sessions).toBe(1)
        expect(first.rows).toBe(1)

        const summary = getUsageSummary(store, 'default', 'all')
        expect(summary.totals.inputTokens).toBe(100 + 900 + 50 + 200 + 800)
        expect(summary.totals.outputTokens).toBe(10 + 5 + 20)
        expect(summary.totals.cacheReadTokens).toBe(900 + 800)
        expect(summary.totals.cacheCreationTokens).toBe(50)
        expect(summary.totals.totalTokens).toBe(2_050 + 35)
        expect(summary.totals.uncachedTokens).toBe(350 + 35)
        expect(summary.totals.requests).toBe(2)
        expect(summary.daily).toHaveLength(1)
        expect(summary.byModel.find((row) => row.key === 'opencode-go/deepseek-v4.1-flash')).toMatchObject({
            inputTokens: 2_050,
            outputTokens: 35,
            requests: 2
        })

        // Re-running replaces the snapshot instead of accumulating.
        await reconcileOpencodeUsage(store, { dbPath })
        expect(getUsageSummary(store, 'default', 'all').totals).toEqual(summary.totals)
        store.close()
    })

    it('keeps remote-reported rows when the local store has no such session', async () => {
        const store = new Store(':memory:')
        const remote = store.sessions.getOrCreateSession(
            'opencode-remote-usage',
            { path: '/tmp', host: 'k2lab', flavor: 'opencode', opencodeSessionId: 'ses_remote' },
            null,
            'default',
            'opencode-go/deepseek-v4.1-flash'
        )
        // The remote session's machine reported a snapshot over `opencode-usage-report`.
        store.usage.replaceReconciled(remote.id, 'default', [{
            sessionId: remote.id,
            day: '2026-09-17',
            model: 'opencode-go/deepseek-v4.1-flash',
            agent: 'opencode',
            inputTokens: 5_000,
            outputTokens: 200,
            cacheReadTokens: 4_700,
            cacheCreationTokens: 0,
            requests: 42
        }], Date.now())

        // The local job scans a store that has no entry for `ses_remote`.
        const dbPath = createOpencodeStore([{
            id: 'msg-local',
            sessionId: 'ses_local_only',
            data: {
                role: 'assistant',
                time: { created: Date.parse('2026-09-17T10:00:00') },
                tokens: { input: 10, output: 1 }
            }
        }])
        const result = await reconcileOpencodeUsage(store, { dbPath })
        expect(result.sessions).toBe(0)
        expect(store.usage.getReconciledByNamespace('default')).toEqual([
            expect.objectContaining({ sessionId: remote.id, requests: 42, inputTokens: 5_000 })
        ])
    })

    it('parses only assistant messages with positive token usage', () => {        expect(parseOpencodeAssistantUsage('not json')).toBeNull()
        expect(parseOpencodeAssistantUsage(JSON.stringify({ role: 'user' }))).toBeNull()
        expect(parseOpencodeAssistantUsage(JSON.stringify({
            role: 'assistant',
            time: { created: Date.parse('2026-09-17T10:00:00') },
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        }))).toBeNull()
        expect(parseOpencodeAssistantUsage(JSON.stringify({
            role: 'assistant',
            modelID: 'deepseek-v4.1-flash',
            time: { created: Date.parse('2026-09-17T10:00:00') },
            tokens: { input: 3, output: 1 }
        }))).toMatchObject({
            model: 'deepseek-v4.1-flash',
            inputTokens: 3,
            outputTokens: 1
        })
    })

    it('resolves the OpenCode store path from the environment', () => {
        expect(resolveOpencodeDbPath({ HAPI_OPENCODE_DB: '/custom/opencode.db' } as NodeJS.ProcessEnv))
            .toBe('/custom/opencode.db')
        expect(resolveOpencodeDbPath({ XDG_DATA_HOME: '/xdg' } as NodeJS.ProcessEnv))
            .toBe('/xdg/opencode/opencode.db')
    })
})
