import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    listOpencodeSessionIds,
    parseOpencodeAssistantUsage,
    readOpencodeUsageForAllSessions,
    readOpencodeUsageForSessions
} from './opencodeUsage'

const CREATED = Date.UTC(2026, 10, 24, 10, 0, 0)

function dayOf(timestamp: number): string {
    const date = new Date(timestamp)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function tokens(input: number) {
    return { input, output: 10, reasoning: 2, cache: { read: 5, write: 0 } }
}

function legacyAssistant(modelId: string, input: number) {
    return JSON.stringify({
        role: 'assistant',
        providerID: 'opencode',
        modelID: modelId,
        time: { created: CREATED },
        tokens: tokens(input)
    })
}

function v2Assistant(modelId: string, input: number) {
    return JSON.stringify({
        model: { providerID: 'opencode', id: modelId, variant: 'low' },
        time: { created: CREATED },
        tokens: tokens(input)
    })
}

let cleanup: Array<() => void> = []

afterEach(() => {
    for (const fn of cleanup) fn()
    cleanup = []
})

function makeDb(withV2: boolean): { db: Database; path: string } {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-opencode-usage-'))
    const path = join(dir, 'opencode.db')
    const db = new Database(path)
    db.exec('CREATE TABLE message (session_id TEXT NOT NULL, data TEXT NOT NULL)')
    if (withV2) {
        db.exec('CREATE TABLE session_message (session_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL)')
    }
    cleanup.push(() => {
        db.close()
        rmSync(dir, { recursive: true, force: true })
    })
    return { db, path }
}

describe('opencode usage reader', () => {
    it('still parses legacy assistant rows with top-level model ids', () => {
        expect(parseOpencodeAssistantUsage(legacyAssistant('flash', 100))).toEqual({
            day: dayOf(CREATED),
            model: 'opencode/flash',
            inputTokens: 105,
            outputTokens: 12,
            cacheReadTokens: 5,
            cacheCreationTokens: 0
        })
    })

    it('parses v2 assistant rows keyed by the table type and nested model', () => {
        const raw = v2Assistant('flash-free', 200)
        expect(parseOpencodeAssistantUsage(raw)).toBeNull()
        expect(parseOpencodeAssistantUsage(raw, 'user')).toBeNull()
        expect(parseOpencodeAssistantUsage(raw, 'assistant')).toEqual({
            day: dayOf(CREATED),
            model: 'opencode/flash-free',
            inputTokens: 205,
            outputTokens: 12,
            cacheReadTokens: 5,
            cacheCreationTokens: 0
        })
    })

    it('reads v2-only sessions and does not double count mirrored rows', async () => {
        const { db, path } = makeDb(true)
        const mirrored = 'ses_mirrored'
        const v2Only = 'ses_v2_only'
        const insertLegacy = db.prepare('INSERT INTO message (session_id, data) VALUES (?, ?)')
        const insertV2 = db.prepare('INSERT INTO session_message (session_id, type, data) VALUES (?, ?, ?)')
        insertLegacy.run(mirrored, legacyAssistant('flash', 100))
        insertV2.run(mirrored, 'assistant', v2Assistant('flash', 100))
        insertV2.run(mirrored, 'user', '{"role":"user"}')
        insertV2.run(v2Only, 'assistant', v2Assistant('flash-free', 200))

        expect((await listOpencodeSessionIds(path)).sort()).toEqual([mirrored, v2Only].sort())

        const all = await readOpencodeUsageForAllSessions(path)
        expect(all.get(mirrored)?.messages).toBe(1)
        expect(all.get(mirrored)?.rows[0]?.inputTokens).toBe(105)
        expect(all.get(v2Only)?.messages).toBe(1)
        expect(all.get(v2Only)?.rows[0]?.model).toBe('opencode/flash-free')
        expect(all.get(v2Only)?.rows[0]?.inputTokens).toBe(205)

        const bySession = await readOpencodeUsageForSessions(path, [mirrored, v2Only, 'ses_missing'])
        expect(bySession.get('ses_missing')).toEqual({ rows: [], messages: 0 })
        expect(bySession.get(mirrored)?.rows[0]?.inputTokens).toBe(105)
        expect(bySession.get(v2Only)?.rows[0]?.inputTokens).toBe(205)
    })

    it('falls back to legacy rows when a v2 session has no assistant usage', async () => {
        const { db, path } = makeDb(true)
        const sessionId = 'ses_legacy_only'
        db.prepare('INSERT INTO message (session_id, data) VALUES (?, ?)')
            .run(sessionId, legacyAssistant('flash', 300))
        db.prepare('INSERT INTO session_message (session_id, type, data) VALUES (?, ?, ?)')
            .run(sessionId, 'user', '{"role":"user"}')

        const usage = await readOpencodeUsageForAllSessions(path)
        expect(usage.get(sessionId)?.rows[0]?.inputTokens).toBe(305)
    })

    it('handles stores without the v2 table', async () => {
        const { db, path } = makeDb(false)
        db.prepare('INSERT INTO message (session_id, data) VALUES (?, ?)')
            .run('ses_legacy', legacyAssistant('flash', 400))
        expect(await listOpencodeSessionIds(path)).toEqual(['ses_legacy'])
        expect((await readOpencodeUsageForAllSessions(path)).get('ses_legacy')?.rows[0]?.inputTokens).toBe(405)
    })
})
