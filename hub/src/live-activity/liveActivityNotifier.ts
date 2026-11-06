import type { SessionEndReason } from '@hapi/protocol'

import type { Store } from '../store'
import type { StoredLiveActivityToken } from '../store/types'
import type { SyncEngine, SyncEvent } from '../sync/syncEngine'
import { extractMessageEventType } from '../notifications/eventParsing'
import type { LiveActivityControl } from './liveActivityControl'
import type { LiveActivityContentState } from './liveActivityContract'
import {
    buildLiveActivityEndState,
    buildLiveActivityPayload,
    buildLiveActivityState,
    isCountOnlyChange,
    liveActivityStateKey,
    type LiveActivityApnsPayload
} from './liveActivityPayload'
import type { LiveActivityPushTransport } from './liveActivityPushTransport'

export type LiveActivityNotifierOptions = {
    /** True only when the hub is in direct-APNs mode. */
    enabled: boolean
    /** Injectable for tests; defaults to Date.now. */
    now?: () => number
    /** Minimum gap between status/title changes. */
    statusThrottleMs?: number
    /** Minimum gap between counter-only changes. */
    countThrottleMs?: number
    /** Flicker guard: wait this long before ending a settled session. */
    endGraceMs?: number
    maxConcurrentSends?: number
}

type Timer = ReturnType<typeof setTimeout>

const DAY_MS = 24 * 60 * 60 * 1000
const APNS_UPDATE_EXPIRATION_SECONDS = 300
const APNS_END_EXPIRATION_SECONDS = 300

/**
 * Turns `SyncEngine` session transitions into iOS Live Activity pushes.
 *
 * This deliberately does not reuse `NotificationHub`: that hub only fires on
 * four discrete notification triggers and suppresses ready/permission updates
 * with its own debounces. Live Activities need every attention/working edge.
 *
 * The hub never *starts* an activity (the app does, then registers the
 * per-activity token); it only updates and ends registered activities.
 */
export class LiveActivityNotifier implements LiveActivityControl {
    private readonly now: () => number
    private readonly statusThrottleMs: number
    private readonly countThrottleMs: number
    private readonly endGraceMs: number
    private readonly maxConcurrentSends: number

    private unsubscribe: (() => void) | null = null
    private stopped = false

    private readonly namespaces = new Map<string, string>()
    private readonly lastStates = new Map<string, LiveActivityContentState>()
    private readonly stateKeys = new Map<string, string>()
    private readonly lastSentAt = new Map<string, number>()
    private readonly lastSentSeconds = new Map<string, number>()
    private readonly reconcileTimers = new Map<string, Timer>()
    private readonly endTimers = new Map<string, Timer>()
    private readonly sendChains = new Map<string, Promise<void>>()

    constructor(
        private readonly syncEngine: SyncEngine,
        private readonly store: Store,
        private readonly transport: LiveActivityPushTransport | null,
        private readonly options: LiveActivityNotifierOptions
    ) {
        this.now = options.now ?? Date.now
        this.statusThrottleMs = options.statusThrottleMs ?? 2_000
        this.countThrottleMs = options.countThrottleMs ?? 5_000
        this.endGraceMs = options.endGraceMs ?? 3_000
        this.maxConcurrentSends = Math.max(1, options.maxConcurrentSends ?? 4)
    }

    isRemoteSupported(): boolean {
        return this.options.enabled
    }

    start(): void {
        if (!this.options.enabled || this.unsubscribe) return
        this.stopped = false
        this.reconcileAll()
        this.unsubscribe = this.syncEngine.subscribe((event) => this.handleEvent(event))
    }

    stop(): void {
        this.stopped = true
        this.unsubscribe?.()
        this.unsubscribe = null
        for (const timer of this.reconcileTimers.values()) clearTimeout(timer)
        for (const timer of this.endTimers.values()) clearTimeout(timer)
        this.reconcileTimers.clear()
        this.endTimers.clear()
    }

    /**
     * Boot reconcile: the app may have registered activities while the hub
     * was down, and `SyncEngine` loads stored sessions before any subscriber
     * exists. Push the current view (or end sessions that vanished) and drop
     * rows older than a Live Activity's maximum lifetime.
     */
    private reconcileAll(): void {
        const now = this.now()
        for (const ref of this.store.liveActivities.listSessionRefs()) {
            this.namespaces.set(ref.sessionId, ref.namespace)
            const session = this.syncEngine.getSession(ref.sessionId)
            if (!session) {
                this.endNow(ref.sessionId, 'cleared')
                continue
            }
            this.reconcile(ref.sessionId, true)
        }
        this.store.liveActivities.pruneOlderThan(now - DAY_MS)
    }

    private handleEvent(event: SyncEvent): void {
        if (!this.options.enabled || this.stopped) return
        const sessionId = 'sessionId' in event ? event.sessionId : undefined
        if (!sessionId) return

        if (event.type === 'session-added' || event.type === 'session-updated') {
            const session = this.syncEngine.getSession(sessionId)
            const namespace = event.namespace ?? session?.namespace
            if (namespace) this.namespaces.set(sessionId, namespace)
            this.reconcile(sessionId)
            return
        }

        if (event.type === 'message-received') {
            // Ready is a user-facing completion edge; let reconcile decide
            // whether the cached session actually settled (it may still be
            // thinking until the follow-up alive patch).
            if (extractMessageEventType(event) === 'ready') {
                this.reconcile(sessionId)
            }
            return
        }

        if (event.type === 'session-ended') {
            const namespace = event.namespace
                ?? this.syncEngine.getSession(sessionId)?.namespace
                ?? this.namespaces.get(sessionId)
            if (namespace) this.namespaces.set(sessionId, namespace)
            this.endNow(sessionId, event.reason)
            return
        }

        if (event.type === 'session-removed') {
            // This event may omit the namespace (sessionCache evicts the
            // cache first). The token store has a namespace-agnostic fallback.
            this.endNow(sessionId, 'cleared')
        }
    }

    /**
     * Recomputes one session. `force` bypasses dedupe and throttle for boot
     * reconcile and genuine token-registration changes.
     */
    reconcile(sessionId: string, force: boolean = false): void {
        if (!this.options.enabled || this.stopped) return
        const tokens = this.tokensFor(sessionId)
        if (tokens.length === 0) {
            this.clearSessionState(sessionId)
            return
        }

        const session = this.syncEngine.getSession(sessionId)
        if (!session) {
            this.endNow(sessionId, 'cleared')
            return
        }
        this.namespaces.set(sessionId, session.namespace)

        const now = this.now()
        const previous = this.lastStates.get(sessionId)
        const state = buildLiveActivityState(session, now, previous)
        if (!state) {
            this.scheduleEnd(sessionId)
            return
        }
        this.cancelEnd(sessionId)

        const key = liveActivityStateKey(state)
        if (!force && this.stateKeys.get(sessionId) === key) return

        const urgent = !isCountOnlyChange(previous, state)
        const throttle = urgent ? this.statusThrottleMs : this.countThrottleMs
        const lastSentAt = this.lastSentAt.get(sessionId) ?? 0
        const wait = force ? 0 : Math.max(0, lastSentAt + throttle - now)
        if (wait > 0) {
            this.scheduleReconcile(sessionId, wait)
            return
        }

        this.stateKeys.set(sessionId, key)
        this.lastStates.set(sessionId, state)
        this.lastSentAt.set(sessionId, now)
        // Use the tokens that existed when this state was computed. A fresh
        // token registered by a new turn must not receive the old state; its
        // own registration reconcile will send the current one.
        this.enqueue(sessionId, () => this.sendUpdate(sessionId, state, urgent, tokens))
    }

    private scheduleReconcile(sessionId: string, delayMs: number): void {
        this.cancelReconcile(sessionId)
        const timer = setTimeout(() => {
            this.reconcileTimers.delete(sessionId)
            this.reconcile(sessionId, true)
        }, Math.max(1, delayMs))
        this.reconcileTimers.set(sessionId, timer)
    }

    private scheduleEnd(sessionId: string): void {
        if (this.endTimers.has(sessionId)) return
        const timer = setTimeout(() => {
            this.endTimers.delete(sessionId)
            this.endNow(sessionId)
        }, Math.max(1, this.endGraceMs))
        this.endTimers.set(sessionId, timer)
    }

    private endNow(sessionId: string, reason?: SessionEndReason): void {
        if (!this.options.enabled || this.stopped) return
        this.cancelReconcile(sessionId)
        this.cancelEnd(sessionId)

        const tokens = this.tokensFor(sessionId)
        const session = this.syncEngine.getSession(sessionId)
        if (tokens.length === 0) {
            this.clearSessionState(sessionId)
            return
        }
        const previous = this.lastStates.get(sessionId)
        const state = buildLiveActivityEndState({
            session,
            previous,
            reason,
            now: this.now()
        })
        this.lastStates.set(sessionId, state)
        this.enqueue(sessionId, async () => {
            // End the tokens that existed when the end was scheduled. A new
            // turn that registers a fresh token while this is queued must
            // not receive the previous turn's end.
            const endedTokens = await this.sendEnd(sessionId, state, tokens)
            for (const row of endedTokens) {
                this.store.liveActivities.removeByToken(row.namespace, row.token)
            }
            this.clearSessionState(sessionId)
        })
    }

    private async sendUpdate(
        sessionId: string,
        state: LiveActivityContentState,
        urgent: boolean,
        tokens: StoredLiveActivityToken[]
    ): Promise<void> {
        if (tokens.length === 0) return
        const timestamp = this.nextTimestamp(sessionId)
        await this.sendToTokens({
            tokens,
            event: 'update',
            state,
            priority: urgent ? 10 : 5,
            expiration: timestamp + APNS_UPDATE_EXPIRATION_SECONDS,
            timestamp
        })
    }

    private async sendEnd(
        sessionId: string,
        state: LiveActivityContentState,
        tokens: StoredLiveActivityToken[]
    ): Promise<StoredLiveActivityToken[]> {
        if (tokens.length === 0) return []
        const timestamp = this.nextTimestamp(sessionId)
        await this.sendToTokens({
            tokens,
            event: 'end',
            state,
            priority: 10,
            expiration: timestamp + APNS_END_EXPIRATION_SECONDS,
            timestamp
        })
        return tokens
    }

    private async sendToTokens(args: {
        tokens: StoredLiveActivityToken[]
        event: 'update' | 'end'
        state: LiveActivityContentState
        priority: number
        expiration: number
        timestamp: number
    }): Promise<void> {
        const transport = this.transport
        if (!transport) return
        for (let index = 0; index < args.tokens.length; index += this.maxConcurrentSends) {
            const chunk = args.tokens.slice(index, index + this.maxConcurrentSends)
            await Promise.all(chunk.map(async (row) => {
                const key = Buffer.from(row.pushKey, 'base64')
                if (key.length !== 32) {
                    console.error('[LiveActivity] Device row has an invalid pushKey; pruning')
                    this.store.liveActivities.removeByToken(row.namespace, row.token)
                    return
                }
                const payload: LiveActivityApnsPayload | null = buildLiveActivityPayload({
                    event: args.event,
                    state: args.state,
                    pushKeyB64: row.pushKey,
                    timestamp: args.timestamp
                })
                if (!payload) {
                    console.error('[LiveActivity] Skipping oversized/unencodable payload')
                    return
                }
                let outcome: 'sent' | 'invalid' | 'failed'
                try {
                    outcome = await transport.sendLiveActivity({
                        token: row.token,
                        payload,
                        priority: args.priority,
                        expiration: args.expiration
                    })
                } catch (error) {
                    console.error(
                        '[LiveActivity] Transport threw:',
                        error instanceof Error ? error.message : error
                    )
                    return
                }
                if (outcome === 'invalid') {
                    this.store.liveActivities.removeByToken(row.namespace, row.token)
                } else if (outcome === 'failed') {
                    console.error('[LiveActivity] Push failed for a device token')
                }
            }))
        }
    }

    private tokensFor(sessionId: string): StoredLiveActivityToken[] {
        const namespace = this.namespaces.get(sessionId)
        if (namespace) {
            const rows = this.store.liveActivities.getForSession(namespace, sessionId)
            if (rows.length > 0) return rows
        }
        return this.store.liveActivities.listForSessionAnyNamespace(sessionId)
    }

    private nextTimestamp(sessionId: string): number {
        const seconds = Math.floor(this.now() / 1000)
        const last = this.lastSentSeconds.get(sessionId) ?? 0
        const next = Math.max(seconds, last + 1)
        this.lastSentSeconds.set(sessionId, next)
        return next
    }

    private enqueue(sessionId: string, task: () => Promise<void>): void {
        const previous = this.sendChains.get(sessionId) ?? Promise.resolve()
        const next = previous
            .then(task)
            .catch((error) => {
                console.error(
                    '[LiveActivity] Send task failed:',
                    error instanceof Error ? error.message : error
                )
            })
        this.sendChains.set(sessionId, next)
        void next.finally(() => {
            if (this.sendChains.get(sessionId) === next) {
                this.sendChains.delete(sessionId)
            }
        })
    }

    private cancelReconcile(sessionId: string): void {
        const timer = this.reconcileTimers.get(sessionId)
        if (timer) {
            clearTimeout(timer)
            this.reconcileTimers.delete(sessionId)
        }
    }

    private cancelEnd(sessionId: string): void {
        const timer = this.endTimers.get(sessionId)
        if (timer) {
            clearTimeout(timer)
            this.endTimers.delete(sessionId)
        }
    }

    private clearSessionState(sessionId: string): void {
        this.cancelReconcile(sessionId)
        this.cancelEnd(sessionId)
        this.lastStates.delete(sessionId)
        this.stateKeys.delete(sessionId)
        this.lastSentAt.delete(sessionId)
        this.lastSentSeconds.delete(sessionId)
        this.namespaces.delete(sessionId)
    }
}
