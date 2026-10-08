import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { Store } from './index'
import { getUsageSummary } from '../sync/usageService'

function createSession(store: Store, namespace: string = 'default') {
    return store.sessions.getOrCreateSession(
        'usage-persistence',
        { path: '/tmp', host: 'test', flavor: 'claude' },
        null,
        namespace,
        'test-model'
    )
}

function usageMessage(id: string, inputTokens: number, outputTokens: number) {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: { id, usage: { input_tokens: inputTokens, output_tokens: outputTokens } }
            }
        }
    }
}

function addUnindexedHistory(store: Store, sessionId: string): void {
    // Represents history persisted by a hub without realtime usage indexing.
    store.messages.copyMessageToSession(sessionId, {
        content: usageMessage('historical-request', 20, 4),
        createdAt: Date.now(),
        localId: null,
        invokedAt: Date.now(),
        scheduledAt: null
    })
}

describe('durable usage persistence', () => {
    it.each(['live', 'imported'] as const)('records %s usage before any dashboard request and keeps it after deletion', (source) => {
        const store = new Store(':memory:')
        try {
            const session = createSession(store)
            const content = usageMessage('request-1', 10, 2)
            if (source === 'live') {
                store.messages.addMessage(session.id, content)
            } else {
                store.messages.addImportedMessage(session.id, content, 'imported-1', Date.now())
                store.messages.addImportedMessage(session.id, content, 'imported-1', Date.now())
            }

            expect(store.usage.getEvents([session.id])).toEqual([
                expect.objectContaining({ inputTokens: 10, outputTokens: 2, model: 'test-model' })
            ])
            expect(store.sessions.deleteSession(session.id, 'default')).toBe(true)
            expect(getUsageSummary(store, 'default', 'all').totals).toMatchObject({
                totalTokens: 12, requests: 1, sessions: 1
            })
        } finally {
            store.close()
        }
    })

    it('retains usage generated after the last dashboard request', () => {
        const store = new Store(':memory:')
        try {
            const session = createSession(store)
            store.messages.addMessage(session.id, usageMessage('request-1', 10, 2))
            expect(getUsageSummary(store, 'default', 'all').totals.totalTokens).toBe(12)

            store.messages.addMessage(session.id, usageMessage('request-2', 20, 4))
            // Streaming updates share the provider message id and count once.
            store.messages.addMessage(session.id, usageMessage('request-2', 30, 6))
            expect(store.sessions.deleteSession(session.id, 'default')).toBe(true)
            for (let read = 0; read < 2; read += 1) {
                expect(getUsageSummary(store, 'default', 'all').totals).toMatchObject({
                    totalTokens: 48, requests: 2, sessions: 1
                })
            }
        } finally {
            store.close()
        }
    })

    it.each(['before-first-read', 'after-previous-read'] as const)('backfills unindexed history before deletion: %s', (scenario) => {
        const store = new Store(':memory:')
        try {
            const session = createSession(store)
            const previousRead = scenario === 'after-previous-read'
            if (previousRead) {
                store.messages.addMessage(session.id, usageMessage('request-1', 10, 2))
                expect(getUsageSummary(store, 'default', 'all').totals.totalTokens).toBe(12)
            }
            addUnindexedHistory(store, session.id)

            expect(store.sessions.deleteSession(session.id, 'default')).toBe(true)
            expect(getUsageSummary(store, 'default', 'all').totals).toMatchObject({
                totalTokens: previousRead ? 36 : 24,
                requests: previousRead ? 2 : 1
            })
        } finally {
            store.close()
        }
    })

    it('does not delete or index another namespace\'s session', () => {
        const store = new Store(':memory:')
        try {
            const session = createSession(store, 'private')
            addUnindexedHistory(store, session.id)
            expect(store.sessions.deleteSession(session.id, 'default')).toBe(false)
            expect(store.sessions.getSession(session.id)).not.toBeNull()
            expect(store.usage.getEventsByNamespace('private')).toEqual([])

            expect(store.sessions.deleteSession(session.id, 'private')).toBe(true)
            expect(getUsageSummary(store, 'default', 'all').totals.totalTokens).toBe(0)
            expect(getUsageSummary(store, 'private', 'all').totals.totalTokens).toBe(24)
        } finally {
            store.close()
        }
    })

    it('indexes Codex cumulative snapshots once and preserves models before any dashboard request', () => {
        const store = new Store(':memory:')
        try {
            const session = store.sessions.getOrCreateSession(
                'codex-usage-persistence',
                { path: '/tmp', host: 'test', flavor: 'codex' },
                null,
                'default',
                'model-one'
            )
            const addSnapshot = (turnId: string, inputTokens: number, outputTokens: number) => {
                store.messages.addMessage(session.id, {
                    role: 'agent',
                    content: {
                        type: 'codex',
                        data: {
                            type: 'token_count',
                            thread_id: 'thread-1',
                            turn_id: turnId,
                            info: {
                                total_token_usage: { input_tokens: inputTokens, output_tokens: outputTokens },
                                last_token_usage: { input_tokens: 100, output_tokens: 10 }
                            }
                        }
                    }
                })
            }
            addSnapshot('turn-1', 1_000, 100)
            store.sessions.setSessionModel(session.id, 'model-two', 'default')
            addSnapshot('turn-1', 1_000, 100)
            addSnapshot('turn-2', 1_140, 115)
            expect(store.usage.getEvents([session.id]).map((event) => event.model)).toEqual(['model-one', 'model-two'])

            expect(store.sessions.deleteSession(session.id, 'default')).toBe(true)
            const summary = getUsageSummary(store, 'default', 'all')
            expect(summary.totals).toMatchObject({ totalTokens: 265, requests: 2 })
            expect(summary.byModel).toEqual([
                expect.objectContaining({ key: 'model-two', totalTokens: 155 }),
                expect.objectContaining({ key: 'model-one', totalTokens: 110 })
            ])
        } finally {
            store.close()
        }
    })

    it('rolls back the message when usage cannot be persisted', () => {
        const store = new Store(':memory:')
        try {
            const session = createSession(store)
            const db = (store as unknown as { db: Database }).db
            db.exec("CREATE TRIGGER reject_usage BEFORE INSERT ON usage_events BEGIN SELECT RAISE(ABORT, 'usage rejected'); END")

            expect(() => store.messages.addMessage(session.id, usageMessage('request-1', 10, 2))).toThrow('usage rejected')
            expect(store.messages.getAllMessages(session.id)).toEqual([])
            expect(store.usage.getEventsByNamespace('default')).toEqual([])
        } finally {
            store.close()
        }
    })

    it('rolls back the backfill when session deletion fails', () => {
        const store = new Store(':memory:')
        try {
            const session = createSession(store)
            addUnindexedHistory(store, session.id)
            const db = (store as unknown as { db: Database }).db
            db.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'delete rejected'); END")

            expect(() => store.sessions.deleteSession(session.id, 'default')).toThrow('delete rejected')
            expect(store.messages.getAllMessages(session.id)).toHaveLength(1)
            expect(store.usage.getEventsByNamespace('default')).toEqual([])
            expect(store.usage.getScanStates([session.id]).size).toBe(0)
        } finally {
            store.close()
        }
    })
})
