import { afterEach, describe, expect, it } from 'bun:test'

import type { Session, SyncEvent, SyncEventListener, SyncEngine } from '../sync/syncEngine'
import { Store } from '../store'
import {
    decryptLiveActivityState,
    type EncryptedLiveActivityState
} from './liveActivityContract'
import { LiveActivityNotifier } from './liveActivityNotifier'
import type {
    LiveActivityPushOutcome,
    LiveActivityPushRequest,
    LiveActivityPushTransport
} from './liveActivityPushTransport'

const KEY = Buffer.alloc(32, 7)
const KEY_B64 = KEY.toString('base64')
const TOKEN = 'aa'.repeat(32)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class FakeSyncEngine {
    private readonly listeners: Set<SyncEventListener> = new Set()
    private readonly sessions: Map<string, Session> = new Map()

    subscribe(listener: SyncEventListener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId)
    }

    setSession(session: Session): void {
        this.sessions.set(session.id, session)
    }

    emit(event: SyncEvent): void {
        for (const listener of this.listeners) listener(event)
    }
}

class FakeTransport implements LiveActivityPushTransport {
    requests: LiveActivityPushRequest[] = []
    outcome: LiveActivityPushOutcome = 'sent'

    async sendLiveActivity(request: LiveActivityPushRequest): Promise<LiveActivityPushOutcome> {
        this.requests.push(request)
        return this.outcome
    }
}

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'sess-1',
        namespace: 'default',
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: 1_700_000_000_000,
        metadata: {
            path: '/Users/x/projects/hapi',
            host: 'm1',
            name: 'Fix widget'
        },
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: true,
        thinkingAt: 1_700_000_000_000,
        activeTurnStartedAt: 1_700_000_000_000,
        backgroundTaskCount: 0,
        todos: [],
        model: null,
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        ...overrides
    }
}

function setup(options: { enabled?: boolean; endGraceMs?: number } = {}) {
    const store = new Store(':memory:')
    store.liveActivities.upsert('default', 'dev-1', 'sess-1', TOKEN, KEY_B64)
    const engine = new FakeSyncEngine()
    const transport = new FakeTransport()
    const clock = { now: 1_700_000_000_000 }
    const notifier = new LiveActivityNotifier(engine as unknown as SyncEngine, store, transport, {
        enabled: options.enabled ?? true,
        now: () => clock.now,
        statusThrottleMs: 0,
        countThrottleMs: 0,
        endGraceMs: options.endGraceMs ?? 5
    })
    return { store, engine, transport, clock, notifier }
}

function decrypted(request: LiveActivityPushRequest) {
    return decryptLiveActivityState(
        request.payload.aps['content-state'] as EncryptedLiveActivityState,
        KEY
    )
}

describe('LiveActivityNotifier', () => {
    let cleanup: (() => void) | null = null
    afterEach(() => {
        cleanup?.()
        cleanup = null
    })

    it('sends an encrypted working update on boot and preserves the turn start', async () => {
        const { store, engine, transport, notifier } = setup()
        cleanup = () => { notifier.stop(); store.close() }
        engine.setSession(createSession())

        notifier.start()
        await sleep(20)

        expect(transport.requests).toHaveLength(1)
        const request = transport.requests[0]!
        expect(request.payload.aps.event).toBe('update')
        expect(request.priority).toBe(10)
        expect(String(request.payload.aps['stale-date'])).toMatch(/^\d+$/)
        expect(JSON.stringify(request.payload)).not.toContain('Fix widget')

        const state = decrypted(request)
        expect(state).toMatchObject({
            status: 'working',
            title: 'Fix widget',
            project: 'hapi',
            startedAt: 1_700_000_000_000,
            pendingCount: 0,
            todoCompleted: 0,
            todoTotal: 0
        })
    })

    it('maps permission and input requests to the attention states', async () => {
        const { store, engine, transport, notifier } = setup()
        cleanup = () => { notifier.stop(); store.close() }
        engine.setSession(createSession({
            agentState: {
                requests: {
                    req1: { tool: 'Edit', arguments: {}, createdAt: 1 }
                }
            }
        }))

        notifier.start()
        await sleep(20)
        expect(decrypted(transport.requests[0]!).status).toBe('needsApproval')
        expect(decrypted(transport.requests[0]!).pendingCount).toBe(1)

        engine.setSession(createSession({
            agentState: {
                requests: {
                    req2: {
                        tool: 'AskUserQuestion',
                        arguments: {},
                        createdAt: 2
                    }
                }
            }
        }))
        engine.emit({ type: 'session-updated', sessionId: 'sess-1' })
        await sleep(20)
        expect(decrypted(transport.requests[1]!).status).toBe('needsInput')
    })

    it('dedupes unchanged state and sends count-only changes at lower priority', async () => {
        const { store, engine, transport, notifier } = setup()
        cleanup = () => { notifier.stop(); store.close() }
        engine.setSession(createSession())

        notifier.start()
        await sleep(20)
        const initialCount = transport.requests.length

        engine.emit({ type: 'session-updated', sessionId: 'sess-1' })
        await sleep(20)
        expect(transport.requests).toHaveLength(initialCount)

        engine.setSession(createSession({
            todos: [
                { content: 'one', status: 'completed', priority: 'medium', id: 't1' },
                { content: 'two', status: 'pending', priority: 'medium', id: 't2' }
            ]
        }))
        engine.emit({ type: 'session-updated', sessionId: 'sess-1' })
        await sleep(20)

        expect(transport.requests).toHaveLength(initialCount + 1)
        const last = transport.requests.at(-1)!
        expect(last.priority).toBe(5)
        expect(decrypted(last)).toMatchObject({ todoCompleted: 1, todoTotal: 2 })
    })

    it('does not treat keep-alive activeAt movement as a new turn start', async () => {
        const { store, engine, transport, notifier } = setup()
        cleanup = () => { notifier.stop(); store.close() }
        // No activeTurnStartedAt/thinkingAt: the previous state's startedAt
        // must win over the volatile activeAt.
        engine.setSession(createSession({
            activeTurnStartedAt: undefined,
            thinkingAt: 0,
            activeAt: 1_700_000_000_000
        }))

        notifier.start()
        await sleep(20)
        const initialCount = transport.requests.length

        engine.setSession(createSession({
            activeTurnStartedAt: undefined,
            thinkingAt: 0,
            activeAt: 1_700_000_010_000
        }))
        engine.emit({ type: 'session-updated', sessionId: 'sess-1' })
        await sleep(20)

        expect(transport.requests).toHaveLength(initialCount)
    })

    it('ends on session-ended, maps errors, and removes the token rows', async () => {
        const { store, engine, transport, notifier } = setup()
        cleanup = () => { notifier.stop(); store.close() }
        engine.setSession(createSession())

        notifier.start()
        await sleep(20)
        engine.emit({ type: 'session-ended', sessionId: 'sess-1', reason: 'error' })
        await sleep(30)

        const last = transport.requests.at(-1)!
        expect(last.payload.aps.event).toBe('end')
        expect(last.priority).toBe(10)
        expect(decrypted(last).status).toBe('error')
        expect(store.liveActivities.listAll()).toHaveLength(0)
    })

    it('handles a namespace-less session-removed by ending via the token row', async () => {
        const { store, engine, transport, notifier } = setup()
        cleanup = () => { notifier.stop(); store.close() }
        engine.setSession(createSession())

        notifier.start()
        await sleep(20)
        engine.emit({ type: 'session-removed', sessionId: 'sess-1' })
        await sleep(30)

        expect(transport.requests.at(-1)!.payload.aps.event).toBe('end')
        expect(decrypted(transport.requests.at(-1)!).status).toBe('done')
        expect(store.liveActivities.listAll()).toHaveLength(0)
    })

    it('prunes a token on APNs invalid', async () => {
        const { store, engine, transport, notifier } = setup()
        cleanup = () => { notifier.stop(); store.close() }
        engine.setSession(createSession())
        transport.outcome = 'invalid'

        notifier.start()
        await sleep(20)

        expect(transport.requests).toHaveLength(1)
        expect(store.liveActivities.listAll()).toHaveLength(0)
    })

    it('ends registered activities whose session vanished before boot', async () => {
        const { store, engine, transport, notifier } = setup()
        cleanup = () => { notifier.stop(); store.close() }
        // No engine.setSession: the token row is stale.

        notifier.start()
        await sleep(20)

        expect(transport.requests).toHaveLength(1)
        expect(transport.requests[0]!.payload.aps.event).toBe('end')
        expect(decrypted(transport.requests[0]!).status).toBe('done')
        expect(store.liveActivities.listAll()).toHaveLength(0)
    })

    it('ends a settled session after the grace window', async () => {
        const { store, engine, transport, notifier } = setup({ endGraceMs: 20 })
        cleanup = () => { notifier.stop(); store.close() }
        engine.setSession(createSession())

        notifier.start()
        await sleep(20)
        engine.setSession(createSession({ thinking: false, active: true }))
        engine.emit({ type: 'session-updated', sessionId: 'sess-1' })
        await sleep(60)

        expect(transport.requests.at(-1)!.payload.aps.event).toBe('end')
        expect(decrypted(transport.requests.at(-1)!).status).toBe('done')
        expect(store.liveActivities.listAll()).toHaveLength(0)
    })

    it('prunes rows with invalid key material without sending', async () => {
        const { store, engine, transport, notifier } = setup()
        cleanup = () => { notifier.stop(); store.close() }
        store.liveActivities.upsert(
            'default',
            'dev-1',
            'sess-1',
            TOKEN,
            Buffer.alloc(16, 1).toString('base64')
        )
        engine.setSession(createSession())

        notifier.start()
        await sleep(20)

        expect(transport.requests).toHaveLength(0)
        expect(store.liveActivities.listAll()).toHaveLength(0)
    })

    it('sends nothing when disabled', async () => {
        const { store, engine, transport, notifier } = setup({ enabled: false })
        cleanup = () => { notifier.stop(); store.close() }
        engine.setSession(createSession())

        notifier.start()
        await sleep(10)

        expect(transport.requests).toHaveLength(0)
        expect(notifier.isRemoteSupported()).toBe(false)
        // Disabled hubs leave registrations alone for a later APNs deployment.
        expect(store.liveActivities.listAll()).toHaveLength(1)
    })

    it('delays an end and cancels it when the session starts working again', async () => {
        const { store, engine, transport, notifier } = setup({ endGraceMs: 100 })
        cleanup = () => { notifier.stop(); store.close() }
        engine.setSession(createSession())

        notifier.start()
        await sleep(20)
        const before = transport.requests.length

        // Settled but not ended: schedule the grace end.
        engine.setSession(createSession({ thinking: false }))
        engine.emit({ type: 'session-updated', sessionId: 'sess-1' })
        await sleep(10)

        // A new turn starts inside the grace window.
        engine.setSession(createSession({ thinking: true }))
        engine.emit({ type: 'session-updated', sessionId: 'sess-1' })
        await sleep(150)

        expect(transport.requests.length).toBe(before)
        expect(store.liveActivities.listAll()).toHaveLength(1)
    })
})
