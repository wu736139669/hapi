import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodexHistoryCheckpoint } from '@hapi/protocol'
import { Store } from './index'

const checkpoint: CodexHistoryCheckpoint = { version: 1, pageCursor: null, turnId: 'turn', itemId: 'item', turnComplete: true }

describe('durable Codex history progress', () => {
    it('survives Hub reopening and invalidates progress when messages are replaced', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-history-store-'))
        const path = join(dir, 'hub.db')
        let store = new Store(path)
        try {
            const sid = store.sessions.getOrCreateSession('history', {}, null, 'default').id
            store.messages.addMessage(sid, { text: 'saved' }, 'output')
            expect(store.historySync.commit(sid, 'thread', { epoch: 0, revision: 0, checkpoint, localIds: ['output'] }))
                .toEqual({ epoch: 0, revision: 1, checkpoint })
            store.close(); store = new Store(path)
            expect(store.historySync.get(sid, 'thread')).toEqual({ epoch: 0, revision: 1, checkpoint })
            expect(store.historySync.get(sid, 'child').checkpoint).toBeNull()
            store.messages.bumpMessageEpoch(sid)
            expect(store.historySync.get(sid, 'thread')).toEqual({ epoch: 1, revision: 1, checkpoint: null })
            expect(store.historySync.commit(sid, 'thread', { epoch: 0, revision: 1, checkpoint, localIds: [] })).toBeNull()
        } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
    })
    it('refuses missing outputs and stale writers instead of advancing across a gap', () => {
        const store = new Store(':memory:')
        try {
            const sid = store.sessions.getOrCreateSession('history', {}, null, 'default').id
            store.messages.addMessage(sid, { text: 'first output' }, 'first')
            const commit = { epoch: 0, revision: 0, checkpoint, localIds: ['first', 'second'] }
            expect(store.historySync.commit(sid, 'thread', commit)).toBeNull()
            expect(store.historySync.get(sid, 'thread').checkpoint).toBeNull()
            store.messages.addMessage(sid, { text: 'second output' }, 'second')
            expect(store.historySync.commit(sid, 'thread', commit)?.revision).toBe(1)
            expect(store.historySync.commit(sid, 'thread', { ...commit, checkpoint: null })).toBeNull()
            expect(store.historySync.get(sid, 'thread').checkpoint).toEqual(checkpoint)
        } finally { store.close() }
    })
    it('keeps the native checkpoint when tail preview and backfill change display pagination', () => {
        const store = new Store(':memory:')
        try {
            const sid = store.sessions.getOrCreateSession('backfill', {}, null, 'default').id
            store.messages.addMessage(sid, { text: 'latest preview' }, 'latest', null, 3_000)
            store.historySync.commit(sid, 'thread', { epoch: 0, revision: 0, checkpoint, localIds: ['latest'] })
            const before = store.historySync.get(sid, 'thread')
            store.messages.addMessage(sid, { text: 'earlier item' }, 'earlier', null, 1_000)
            store.messages.addImportedMessage(sid, { text: 'earlier imported item' }, 'imported', 2_000)
            expect(store.messages.getMessageEpoch(sid)).toBe(2)
            expect(store.historySync.get(sid, 'thread')).toEqual(before)
            expect(store.historySync.commit(sid, 'thread', { ...before, localIds: ['earlier', 'imported'] })?.revision).toBe(2)
            store.messages.truncateMessagesFromLocalId(sid, 'earlier', [])
            expect(store.historySync.get(sid, 'thread').checkpoint).toBeNull()
            expect(store.historySync.commit(sid, 'thread', { ...before, localIds: [] })).toBeNull()
        } finally { store.close() }
    })
    it('does not adopt the display epoch again after a Hub restart', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-history-backfill-'))
        const path = join(dir, 'hub.db')
        let store = new Store(path)
        try {
            const sid = store.sessions.getOrCreateSession('history', {}, null, 'default').id
            store.messages.addMessage(sid, { text: 'latest' }, 'latest', null, 3_000)
            store.messages.addMessage(sid, { text: 'earlier' }, 'earlier', null, 1_000)
            const saved = store.historySync.commit(sid, 'thread', { epoch: 0, revision: 0, checkpoint, localIds: ['earlier'] })
            if (!saved) throw new Error('Expected a durable checkpoint')
            store.close(); store = new Store(path)
            expect(store.historySync.get(sid, 'thread')).toEqual(saved)
        } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
    })
    it('retains the old invalidation fence while upgrading an existing database', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-history-upgrade-'))
        const path = join(dir, 'hub.db')
        let store = new Store(path)
        try {
            const sid = store.sessions.getOrCreateSession('legacy', {}, null, 'default').id
            store.messages.addMessage(sid, { text: 'saved' }, 'saved')
            store.historySync.commit(sid, 'thread', { epoch: 0, revision: 0, checkpoint, localIds: ['saved'] })
            store.messages.bumpMessageEpoch(sid)
            store.close()
            const legacy = new Database(path)
            legacy.exec('DROP TABLE codex_history_epochs'); legacy.close()
            store = new Store(path)
            expect(store.historySync.get(sid, 'thread')).toEqual({ epoch: 1, revision: 1, checkpoint: null })
            expect(store.historySync.commit(sid, 'thread', { epoch: 0, revision: 1, checkpoint, localIds: ['saved'] })).toBeNull()
        } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
    })
})
