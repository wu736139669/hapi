import { afterEach, describe, expect, it } from 'bun:test'

import type { IosPushSendResult } from '../push-ios/iosPushService'
import type { Session, SyncEngine, SyncEvent, SyncEventListener } from '../sync/syncEngine'
import { WidgetRefreshNotifier, widgetFingerprint, type WidgetRefreshSender } from './widgetRefreshNotifier'

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

    getSessionsByNamespace(namespace: string): Session[] {
        return [...this.sessions.values()].filter((session) => session.namespace === namespace)
    }

    setSession(session: Session): void {
        this.sessions.set(session.id, session)
    }

    removeSession(sessionId: string): void {
        this.sessions.delete(sessionId)
    }

    emit(event: SyncEvent): void {
        for (const listener of this.listeners) listener(event)
    }
}

class FakeSender implements WidgetRefreshSender {
    namespaces: string[] = []
    result: IosPushSendResult = { sent: 1, failed: 0, invalidTokens: [] }

    async sendToNamespace(namespace: string): Promise<IosPushSendResult> {
        this.namespaces.push(namespace)
        return this.result
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

function setup(options: { enabled?: boolean; throttleMs?: number } = {}) {
    const engine = new FakeSyncEngine()
    const sender = new FakeSender()
    const notifier = new WidgetRefreshNotifier(engine as unknown as SyncEngine, sender, {
        enabled: options.enabled ?? true,
        debounceMs: 0,
        throttleMs: options.throttleMs ?? 0
    })
    return { engine, sender, notifier }
}

async function emitAndSettle(
    engine: FakeSyncEngine,
    event: SyncEvent,
    waitMs = 10
): Promise<void> {
    engine.emit(event)
    await sleep(waitMs)
}

describe('WidgetRefreshNotifier', () => {
    let cleanup: (() => void) | null = null
    afterEach(() => {
        cleanup?.()
        cleanup = null
    })

    it('sends once per widget-visible state change and ignores message-only updates', async () => {
        const { engine, sender, notifier } = setup()
        cleanup = () => notifier.stop()
        engine.setSession(createSession())
        notifier.start()

        await emitAndSettle(engine, {
            type: 'session-added',
            sessionId: 'sess-1',
            namespace: 'default'
        })
        expect(sender.namespaces).toEqual(['default'])
        const firstFingerprint = widgetFingerprint(engine.getSessionsByNamespace('default'))

        // A message/keepalive update does not touch the widget contract.
        engine.setSession(createSession({ updatedAt: 9_999 }))
        await emitAndSettle(engine, {
            type: 'session-updated',
            sessionId: 'sess-1',
            namespace: 'default'
        })
        expect(sender.namespaces).toHaveLength(1)
        expect(widgetFingerprint(engine.getSessionsByNamespace('default'))).toBe(firstFingerprint)

        // Thinking changes the bucket.
        engine.setSession(createSession({ thinking: false, metadata: { path: '/Users/x/projects/hapi', host: 'm1', name: 'Fix widget', lifecycleState: 'idle' } }))
        await emitAndSettle(engine, {
            type: 'session-updated',
            sessionId: 'sess-1',
            namespace: 'default'
        })
        expect(sender.namespaces).toHaveLength(2)

        // Title changes are visible in the widget row.
        engine.setSession(createSession({ thinking: false, metadata: { path: '/Users/x/projects/hapi', host: 'm1', name: 'Renamed' } }))
        await emitAndSettle(engine, {
            type: 'session-updated',
            sessionId: 'sess-1',
            namespace: 'default'
        })
        expect(sender.namespaces).toHaveLength(3)
    })

    it('sends after a session disappears', async () => {
        const { engine, sender, notifier } = setup()
        cleanup = () => notifier.stop()
        engine.setSession(createSession())
        notifier.start()

        await emitAndSettle(engine, {
            type: 'session-added',
            sessionId: 'sess-1',
            namespace: 'default'
        })
        engine.removeSession('sess-1')
        await emitAndSettle(engine, {
            type: 'session-removed',
            sessionId: 'sess-1'
        })
        expect(sender.namespaces).toEqual(['default', 'default'])
    })

    it('throttles bursts and coalesces to the latest state', async () => {
        const { engine, sender, notifier } = setup({ throttleMs: 100 })
        cleanup = () => notifier.stop()
        engine.setSession(createSession())
        notifier.start()

        await emitAndSettle(engine, {
            type: 'session-added',
            sessionId: 'sess-1',
            namespace: 'default'
        })
        expect(sender.namespaces).toHaveLength(1)

        engine.setSession(createSession({ thinking: false }))
        await emitAndSettle(engine, {
            type: 'session-updated',
            sessionId: 'sess-1',
            namespace: 'default'
        })
        engine.setSession(createSession({ thinking: false, metadata: { path: '/Users/x/projects/hapi', host: 'm1', name: 'Renamed' } }))
        await emitAndSettle(engine, {
            type: 'session-updated',
            sessionId: 'sess-1',
            namespace: 'default'
        })
        expect(sender.namespaces).toHaveLength(1)
        await sleep(150)
        expect(sender.namespaces).toHaveLength(2)
    })

    it('does nothing when disabled', async () => {
        const { engine, sender, notifier } = setup({ enabled: false })
        cleanup = () => notifier.stop()
        engine.setSession(createSession())
        notifier.start()
        await emitAndSettle(engine, {
            type: 'session-added',
            sessionId: 'sess-1',
            namespace: 'default'
        })
        expect(sender.namespaces).toHaveLength(0)
    })

    it('ignores non-widget events', async () => {
        const { engine, sender, notifier } = setup()
        cleanup = () => notifier.stop()
        engine.setSession(createSession())
        notifier.start()
        await emitAndSettle(engine, {
            type: 'message-received',
            sessionId: 'sess-1',
            namespace: 'default'
        } as SyncEvent)
        expect(sender.namespaces).toHaveLength(0)
    })
})
