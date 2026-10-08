import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { Store } from '../store'
import type { UsageEvent } from '../store/usage'
import { mergeRecoveredUsage } from './usageRecovery'
import { getUsageSummary } from './usageService'

function event(key: string, sessionId = 'deleted', extra: Partial<UsageEvent> = {}): UsageEvent {
    return { sessionId, sourceKey: key, sourceSeq: 1, createdAt: Date.now() - 1000,
        agent: 'dsh', model: null, kind: 'delta', inputTokens: 100, outputTokens: 10,
        cacheReadTokens: 80, cacheCreationTokens: 0, lastInputTokens: null, lastOutputTokens: null,
        lastCacheReadTokens: null, lastCacheCreationTokens: null, ...extra }
}

describe('usage recovery', () => {
    it('can resume an interrupted backfill without advancing its cursor or duplicating usage', () => {
        const store = new Store(':memory:')
        const db = (store as unknown as { db: Database }).db
        const events = Array.from({ length: 300 }, (_, index) => event(`delta|${index}`, 'deleted', { sourceSeq: index + 1 }))
        db.exec(`CREATE TRIGGER interrupt_backfill BEFORE INSERT ON usage_events
            WHEN NEW.source_key = 'delta|257' BEGIN SELECT RAISE(ABORT, 'interrupted'); END`)
        expect(() => store.usage.recordScan('deleted', 'default', 0, 300, events, false)).toThrow('interrupted')
        expect(store.usage.getScanStates(['deleted']).size).toBe(0)
        expect(store.usage.getEvents(['deleted']).length).toBeGreaterThan(0)
        db.exec('DROP TRIGGER interrupt_backfill')
        store.usage.recordScan('deleted', 'default', 0, 300, events, false)
        expect(store.usage.getScanStates(['deleted']).get('deleted')?.lastSeq).toBe(300)
        expect(getUsageSummary(store, 'default', 'all').totals.requests).toBe(300)
        store.close()
    })

    it('matches identical requests one-to-one and remains idempotent', () => {
        const store = new Store(':memory:')
        store.usage.recordScan('deleted', 'default', 0, 0, [event('delta|a')], false)
        const recovered = [event('native|a'), event('native|b')]
        expect(mergeRecoveredUsage(store, 'default', recovered)).toEqual({ inserted: 1, matched: 1, enriched: 0 })
        expect(getUsageSummary(store, 'default', 'all').totals.requests).toBe(2)
        expect(mergeRecoveredUsage(store, 'default', recovered).inserted).toBe(0)
        expect(getUsageSummary(store, 'default', 'all').totals.requests).toBe(2)
        store.close()
    })

    it('indexes wrapped Codex child usage and ignores replay under a different scope label', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('child-parent', { flavor: 'codex' }, null, 'default')
        const data = { type: 'token_count', thread_id: 'child-thread', info: {
            total_token_usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 80 },
            last_token_usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 80 }
        }, model: 'child-model' }
        store.messages.addMessage(session.id, { role: 'agent', content: { type: 'codex', data: {
            type: 'agent-run-trace', scope: { role: 'child', threadId: 'child-thread' }, message: data
        } } })
        store.messages.addMessage(session.id, { role: 'agent', content: { type: 'codex', data } })
        store.messages.addMessage(session.id, { role: 'agent', content: { type: 'codex', data: {
            type: 'agent-run-trace', hapiUsageScope: 'imported-history', message: { ...data, thread_id: 'pre-hapi-child' }
        } } })
        expect(store.usage.getEvents([session.id])).toHaveLength(2)
        store.sessions.deleteSession(session.id, 'default')
        const summary = getUsageSummary(store, 'default', 'all')
        expect(summary.totals).toMatchObject({ inputTokens: 100, outputTokens: 10, requests: 1 })
        expect(summary.byModel[0]?.key).toBe('child-model')
        store.close()
    })

    it('enriches a partial Claude update across session aliases without adding a request', () => {
        const store = new Store(':memory:')
        store.usage.recordScan('deleted', 'default', 0, 0, [event('claude|msg', 'deleted', { agent: 'claude', outputTokens: 2 })], false)
        expect(mergeRecoveredUsage(store, 'default', [event('claude|msg', 'alias', { agent: 'claude', model: 'claude-test' })]))
            .toEqual({ inserted: 0, matched: 1, enriched: 1 })
        expect(getUsageSummary(store, 'default', 'all').totals).toMatchObject({ requests: 1, outputTokens: 10 })
        store.close()
    })

    it('replaces an estimated model only when the recovered provider record identifies its actual model', () => {
        const store = new Store(':memory:')
        store.usage.recordScan('deleted', 'default', 0, 0, [event('delta|a', 'deleted', { model: 'estimated' })], false)
        const recovered = [event('native|a', 'deleted', { model: 'actual' })]
        expect(mergeRecoveredUsage(store, 'default', recovered).enriched).toBe(0)
        expect(mergeRecoveredUsage(store, 'default', recovered, new Set(['dsh|native|a'])).enriched).toBe(1)
        const summary = getUsageSummary(store, 'default', 'all')
        expect(summary.totals.requests).toBe(1)
        expect(summary.byModel[0]?.key).toBe('actual')
        store.close()
    })

    it('matches Codex snapshots despite turn-id wire differences and preserves resets', () => {
        const store = new Store(':memory:')
        const first = event('cumulative|thread|parent||100|10|80|0', 'deleted', {
            agent: 'codex', kind: 'cumulative', lastInputTokens: 100, lastOutputTokens: 10,
            lastCacheReadTokens: 80, lastCacheCreationTokens: 0
        })
        store.usage.recordScan('deleted', 'default', 0, 0, [first], false)
        const recovered = [{ ...first, sourceKey: 'cumulative|thread|parent|turn-1|100|10|80|0' },
            { ...first, sourceKey: 'cumulative|thread|parent|turn-2|50|5|40|0', sourceSeq: 2,
                createdAt: first.createdAt + 100, inputTokens: 50, outputTokens: 5, cacheReadTokens: 40,
                lastInputTokens: 50, lastOutputTokens: 5, lastCacheReadTokens: 40 }]
        expect(mergeRecoveredUsage(store, 'default', recovered).inserted).toBe(1)
        expect(getUsageSummary(store, 'default', 'all').totals).toMatchObject({ requests: 2, inputTokens: 150, outputTokens: 15 })
        expect(mergeRecoveredUsage(store, 'default', recovered).inserted).toBe(0)
        store.close()
    })

    it('keeps native snapshots through deletion and merging multiple native sources', () => {
        const store = new Store(':memory:')
        const a = store.sessions.getOrCreateSession('a', { machineId: 'm', flavor: 'opencode', opencodeSessionId: 'native-a' }, null, 'default')
        const b = store.sessions.getOrCreateSession('b', { machineId: 'm', flavor: 'opencode', opencodeSessionId: 'native-b' }, null, 'default')
        const rows = [{ day: '2026-09-17', agent: 'opencode', model: 'test', inputTokens: 100,
            outputTokens: 10, cacheReadTokens: 80, cacheCreationTokens: 0, requests: 1 }]
        for (const source of store.usage.getSources()) store.usage.reconcileSource(source, rows, Date.now())
        store.usage.recordScan(a.id, 'default', 0, 0, [event('delta|a', a.id, { agent: 'opencode' })], false)
        store.usage.transferSession(a.id, b.id)
        store.sessions.deleteSession(a.id, 'default')
        store.sessions.deleteSession(b.id, 'default')
        expect(store.usage.getSources().filter((source) => source.sessionId === b.id)).toHaveLength(2)
        expect(store.usage.getEventsByNamespace('default')).toHaveLength(1)
        expect(store.usage.getEventsByNamespace('default')[0]?.sessionId).toBe(b.id)
        expect(getUsageSummary(store, 'default', 'all').totals).toMatchObject({ requests: 2, inputTokens: 200, sessions: 1 })
        for (const source of store.usage.getSources()) store.usage.reconcileSource(source, rows, Date.now())
        expect(getUsageSummary(store, 'default', 'all').totals.requests).toBe(2)
        store.close()
    })

    it('does not recreate transferred usage when a copied source is deleted', () => {
        const store = new Store(':memory:')
        const a = store.sessions.getOrCreateSession('source', { flavor: 'claude' }, null, 'default')
        const b = store.sessions.getOrCreateSession('target', { flavor: 'claude' }, null, 'default')
        const content = { role: 'agent', content: { type: 'output', data: {
            type: 'assistant', message: { id: 'provider-id', usage: { input_tokens: 100, output_tokens: 10 } }
        } } }
        for (const session of [a, b]) store.messages.copyMessageToSession(session.id, {
            content, createdAt: Date.now() - 100, localId: null, invokedAt: null, scheduledAt: null
        })
        store.usage.transferSession(a.id, b.id)
        store.sessions.deleteSession(a.id, 'default')
        expect(getUsageSummary(store, 'default', 'all').totals).toMatchObject({ inputTokens: 100, requests: 1 })
        expect(store.usage.getEvents([a.id])).toHaveLength(0)
        store.close()
    })

    it('ignores a snapshot collected before an already applied report', () => {
        const store = new Store(':memory:')
        const source = { namespace: 'default', machineId: 'm', agent: 'opencode', nativeSessionId: 'n', sessionId: 'deleted' }
        const row = { day: '2026-09-17', agent: 'opencode', model: 'test', inputTokens: 100,
            outputTokens: 10, cacheReadTokens: 80, cacheCreationTokens: 0, requests: 1 }
        store.usage.reconcileSource(source, [{ ...row, requests: 2 }], 200)
        store.usage.reconcileSource(source, [row], 100)
        expect(getUsageSummary(store, 'default', 'all').totals.requests).toBe(2)
        store.close()
    })

    it('retains both legacy snapshots when their day/model keys collide during merge', () => {
        const store = new Store(':memory:')
        const a = store.sessions.getOrCreateSession('legacy-a', { flavor: 'opencode' }, null, 'default')
        const b = store.sessions.getOrCreateSession('legacy-b', { flavor: 'opencode' }, null, 'default')
        const row = { day: '2026-09-17', agent: 'opencode', model: 'test', inputTokens: 100,
            outputTokens: 10, cacheReadTokens: 80, cacheCreationTokens: 0, requests: 1 }
        for (const session of [a, b]) {
            store.usage.replaceReconciled(session.id, 'default', [{ ...row, sessionId: session.id }], Date.now())
            store.usage.recordScan(session.id, 'default', 0, 0, [event(`delta|${session.id}`, session.id, { agent: 'opencode' })], false)
        }
        store.usage.transferSession(a.id, b.id)
        store.sessions.deleteSession(a.id, 'default')
        expect(getUsageSummary(store, 'default', 'all').totals).toMatchObject({ inputTokens: 200, requests: 2 })
        store.close()
    })

    it('counts a native snapshot once when an older hub recreates its legacy alias', () => {
        const store = new Store(':memory:')
        const source = { namespace: 'default', machineId: 'm', agent: 'opencode', nativeSessionId: 'n', sessionId: 'old-session' }
        const row = { day: '2026-09-17', agent: 'opencode', model: 'test', inputTokens: 100,
            outputTokens: 10, cacheReadTokens: 80, cacheCreationTokens: 0, requests: 1 }
        store.usage.reconcileSource(source, [row], 100)
        store.usage.replaceReconciled(source.sessionId, 'default', [{ ...row, sessionId: source.sessionId }], 200)
        expect(getUsageSummary(store, 'default', 'all').totals.requests).toBe(1)
        store.usage.reconcileSource(source, [row], 150)
        expect(getUsageSummary(store, 'default', 'all').totals.requests).toBe(1)
        store.close()
    })
})
