import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUsageScanRequest, runUsageScan } from './usageScan'

function createOpencodeStore(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-usage-scan-'))
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
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
        'msg-1',
        'ses_scan',
        Date.parse('2026-09-17T10:00:00'),
        Date.parse('2026-09-17T10:00:00'),
        JSON.stringify({
            role: 'assistant',
            providerID: 'opencode-go',
            modelID: 'deepseek-v4.1-flash',
            time: { created: Date.parse('2026-09-17T10:00:00') },
            tokens: { input: 7, output: 3, reasoning: 1, cache: { read: 5, write: 2 } }
        })
    )
    db.close()
    return dbPath
}

describe('usage-scan command', () => {
    it('returns the hub-facing payload for the requested sessions', async () => {
        const dbPath = createOpencodeStore()
        try {
            const payload = await runUsageScan({ dbPath, sessionIds: ['ses_scan', 'ses_missing'] })
            expect(payload.results.ses_scan.messages).toBe(1)
            expect(payload.results.ses_scan.rows).toEqual([
                expect.objectContaining({
                    day: '2026-09-17',
                    model: 'opencode-go/deepseek-v4.1-flash',
                    inputTokens: 14,
                    outputTokens: 4,
                    requests: 1
                })
            ])
            expect(payload.results.ses_missing).toEqual({ rows: [], messages: 0 })
        } finally {
            rmSync(join(dbPath, '..'), { recursive: true, force: true })
        }
    })

    it('listAll scans every session present in the store', async () => {
        const dbPath = createOpencodeStore()
        try {
            const payload = await runUsageScan({ dbPath, listAll: true })
            expect(Object.keys(payload.results)).toEqual(['ses_scan'])
            expect(payload.results.ses_scan.messages).toBe(1)
            // The sequential all-sessions pass must match the indexed
            // per-session reads (this path feeds the runner's reports).
            const perSession = await runUsageScan({ dbPath, sessionIds: ['ses_scan'] })
            expect(payload.results.ses_scan).toEqual(perSession.results.ses_scan)
        } finally {
            rmSync(join(dbPath, '..'), { recursive: true, force: true })
        }
    })

    it('rejects malformed requests', () => {
        expect(() => parseUsageScanRequest('not json')).toThrow()
        expect(() => parseUsageScanRequest('{"sessionIds":[]}')).toThrow()
        expect(parseUsageScanRequest('{"dbPath":"/x","sessionIds":["ses_a",3,""]}')).toEqual({
            dbPath: '/x',
            sessionIds: ['ses_a']
        })
        expect(parseUsageScanRequest('{"dbPath":"/x","listAll":true}')).toEqual({
            dbPath: '/x',
            listAll: true
        })
    })
})
