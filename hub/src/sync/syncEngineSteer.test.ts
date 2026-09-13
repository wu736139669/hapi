import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

type EngineInternals = {
    rpcGateway: {
        steerQueuedMessage: (
            sessionId: string,
            localId: string
        ) => Promise<{ steered: boolean; error?: string }>
    }
}

function setup(options: { flavor?: 'codex' | 'claude'; scheduledAt?: number } = {}) {
    const store = new Store(':memory:')
    const engine = new SyncEngine(
        store,
        {} as never,
        new RpcRegistry(),
        { broadcast() {} } as never
    )
    engine.stop()
    const session = engine.getOrCreateSession(
        'steer-session',
        {
            path: '/tmp/steer-session',
            host: 'localhost',
            flavor: options.flavor ?? 'codex'
        },
        null,
        'default'
    )
    const message = store.messages.addMessage(
        session.id,
        { role: 'user', content: { type: 'text', text: 'new direction' } },
        'persisted-local-id',
        options.scheduledAt ?? null
    )
    return { engine, session, message }
}

describe('SyncEngine steerQueuedMessage', () => {
    it('rejects unsupported agents before RPC', async () => {
        const { engine, session, message } = setup({ flavor: 'claude' })

        await expect(engine.steerQueuedMessage(session.id, message.id)).resolves.toEqual({
            status: 'failed',
            error: 'Steering is not supported for this agent',
            localId: null
        })
    })

    it('rejects future-scheduled rows before RPC', async () => {
        const { engine, session, message } = setup({ scheduledAt: Date.now() + 60_000 })

        await expect(engine.steerQueuedMessage(session.id, message.id)).resolves.toEqual({
            status: 'failed',
            error: 'Scheduled messages cannot be steered',
            localId: 'persisted-local-id'
        })
    })

    it('forwards the persisted local ID to the session RPC', async () => {
        const { engine, session, message } = setup()
        const calls: Array<{ sessionId: string; localId: string }> = []
        const internals = engine as unknown as EngineInternals
        internals.rpcGateway.steerQueuedMessage = async (sessionId, localId) => {
            calls.push({ sessionId, localId })
            return { steered: true }
        }

        await expect(engine.steerQueuedMessage(session.id, message.id)).resolves.toEqual({
            status: 'steered',
            localId: 'persisted-local-id'
        })
        expect(calls).toEqual([{ sessionId: session.id, localId: 'persisted-local-id' }])
    })
})
