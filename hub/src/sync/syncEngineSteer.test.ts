import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

type SteerRpcResult = { steered: boolean; error?: string }
type EngineInternals = {
    rpcGateway: {
        steerQueuedMessage: (sessionId: string, localId: string) => Promise<SteerRpcResult>
    }
    messageService: {
        cancelQueuedMessage: (
            sessionId: string,
            messageId: string
        ) => Promise<{ status: 'cancelled'; localId: string | null }>
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
        'codex-steer',
        { path: '/tmp/codex-steer', host: 'localhost', flavor: options.flavor ?? 'codex' },
        null,
        'default'
    )
    const message = store.messages.addMessage(
        session.id,
        { role: 'user', content: { type: 'text', text: 'new direction' } },
        'local-steer',
        options.scheduledAt ?? null
    )
    return { engine, store, session, message }
}

describe('SyncEngine steerQueuedMessage', () => {
    it('rejects unsupported agents and future-scheduled rows before RPC', async () => {
        const unsupported = setup({ flavor: 'claude' })
        await expect(unsupported.engine.steerQueuedMessage(
            unsupported.session.id,
            unsupported.message.id
        )).resolves.toEqual({
            status: 'failed',
            error: 'Steering is only supported for Codex sessions',
            localId: null
        })

        const scheduled = setup({ scheduledAt: Date.now() + 60_000 })
        await expect(scheduled.engine.steerQueuedMessage(
            scheduled.session.id,
            scheduled.message.id
        )).resolves.toEqual({
            status: 'failed',
            error: 'Scheduled messages cannot be steered',
            localId: 'local-steer'
        })
    })

    it('forwards the persisted local ID to the Codex session RPC', async () => {
        const { engine, session, message } = setup()
        const calls: Array<{ sessionId: string; localId: string }> = []
        const internals = engine as unknown as EngineInternals
        internals.rpcGateway.steerQueuedMessage = async (sessionId: string, localId: string) => {
            calls.push({ sessionId, localId })
            return { steered: true }
        }

        await expect(engine.steerQueuedMessage(session.id, message.id)).resolves.toEqual({
            status: 'steered',
            localId: 'local-steer'
        })
        expect(calls).toEqual([{ sessionId: session.id, localId: 'local-steer' }])
    })

    it('waits for an in-flight steer before cancelling the same queued row', async () => {
        const { engine, session, message } = setup()
        let resolveSteer!: (result: SteerRpcResult) => void
        const pendingSteer = new Promise<SteerRpcResult>((resolve) => {
            resolveSteer = resolve
        })
        const internals = engine as unknown as EngineInternals
        internals.rpcGateway.steerQueuedMessage = () => pendingSteer

        let cancelCalled = false
        internals.messageService.cancelQueuedMessage = async () => {
            cancelCalled = true
            return { status: 'cancelled', localId: 'local-steer' }
        }

        const steer = engine.steerQueuedMessage(session.id, message.id)
        const cancel = engine.cancelQueuedMessage(session.id, message.id)
        await Promise.resolve()
        expect(cancelCalled).toBe(false)

        resolveSteer({ steered: false, error: 'turn ended' })

        await expect(steer).resolves.toEqual({
            status: 'failed',
            error: 'turn ended',
            localId: 'local-steer'
        })
        await expect(cancel).resolves.toEqual({ status: 'cancelled', localId: 'local-steer' })
        expect(cancelCalled).toBe(true)
    })
})
