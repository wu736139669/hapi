import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { getUsageSummary } from './usageService'

function addAgentMessage(store: Store, sessionId: string, content: unknown): void {
    store.messages.addMessage(sessionId, { role: 'agent', content })
}

describe('usage service', () => {
    it('deduplicates Claude stream fragments and diffs Codex cumulative snapshots', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'usage-test',
            { path: '/tmp', host: 'test', flavor: 'codex' },
            null,
            'default',
            'test-model'
        )

        addAgentMessage(store, session.id, {
            type: 'output',
            data: {
                type: 'assistant',
                message: { id: 'claude-message', model: 'claude-test', usage: { input_tokens: 10, output_tokens: 2 } }
            }
        })
        addAgentMessage(store, session.id, {
            type: 'output',
            data: {
                type: 'assistant',
                message: { id: 'claude-message', model: 'claude-test', usage: { input_tokens: 12, output_tokens: 3 } }
            }
        })
        addAgentMessage(store, session.id, {
            type: 'codex',
            data: { type: 'token_count', thread_id: 'thread-1', scope_role: 'parent', info: { total: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 80 } } }
        })
        addAgentMessage(store, session.id, {
            type: 'codex',
            data: { type: 'token_count', thread_id: 'thread-1', scope_role: 'parent', info: { total: { inputTokens: 140, outputTokens: 15, cachedInputTokens: 100 } } }
        })

        const result = getUsageSummary(store, 'default', 'all')
        expect(result.totals.requests).toBe(3)
        expect(result.totals.inputTokens).toBe(152)
        expect(result.totals.outputTokens).toBe(18)
        expect(result.totals.cacheReadTokens).toBe(100)
        expect(result.totals.totalTokens).toBe(170)
        expect(result.byAgent.find((row) => row.key === 'claude')?.requests).toBe(1)
        expect(result.byModel.find((row) => row.key === 'claude-test')?.totalTokens).toBe(15)
        store.close()
    })
})
