import { toSessionSummary } from '@hapi/protocol'

import type { Session, SyncEngine, SyncEvent } from '../sync/syncEngine'
import type { IosPushSendResult } from '../push-ios/iosPushService'

export type WidgetRefreshSender = {
    sendToNamespace(namespace: string): Promise<IosPushSendResult>
}

export type WidgetRefreshNotifierOptions = {
    /** True only when the hub is in direct-APNs mode. */
    enabled: boolean
    /** Coalesce bursts of session patches. */
    debounceMs?: number
    /** Minimum gap between silent wakes for one namespace. */
    throttleMs?: number
    /**
     * Extra fingerprint for widget-visible data that lives outside the
     * in-memory Session (currently the last assistant result preview).
     * Without this, a result that lands while the status stays `working`
     * never wakes the phone.
     */
    assistantPreviewFingerprint?: (sessionIds: readonly string[]) => string
    now?: () => number
}

type Timer = ReturnType<typeof setTimeout>

const DEFAULT_DEBOUNCE_MS = 750
const DEFAULT_THROTTLE_MS = 30_000

/**
 * Turns widget-visible session transitions into silent APNs wake-ups. The
 * app does the actual snapshot work after waking; this notifier only decides
 * *when* a refresh is worth requesting.
 *
 * The fingerprint deliberately excludes `updatedAt` and message content:
 * a streaming conversation must not wake the phone for every token. It does
 * include the status bucket, pending/todo/background counters, title/project,
 * and the turn-start timestamp.
 */
export class WidgetRefreshNotifier {
    private readonly debounceMs: number
    private readonly throttleMs: number
    private readonly now: () => number

    private unsubscribe: (() => void) | null = null
    private stopped = false

    private readonly namespaces = new Map<string, string>()
    private readonly lastFingerprint = new Map<string, string>()
    private readonly lastSentAt = new Map<string, number>()
    private readonly debounceTimers = new Map<string, Timer>()
    private readonly throttleTimers = new Map<string, Timer>()

    constructor(
        private readonly syncEngine: SyncEngine,
        private readonly sender: WidgetRefreshSender,
        private readonly options: WidgetRefreshNotifierOptions
    ) {
        this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS)
        this.throttleMs = Math.max(0, options.throttleMs ?? DEFAULT_THROTTLE_MS)
        this.now = options.now ?? Date.now
    }

    start(): void {
        if (!this.options.enabled || this.unsubscribe) return
        this.stopped = false
        this.unsubscribe = this.syncEngine.subscribe((event) => this.handleEvent(event))
    }

    stop(): void {
        this.stopped = true
        this.unsubscribe?.()
        this.unsubscribe = null
        for (const timer of this.debounceTimers.values()) clearTimeout(timer)
        for (const timer of this.throttleTimers.values()) clearTimeout(timer)
        this.debounceTimers.clear()
        this.throttleTimers.clear()
    }

    private handleEvent(event: SyncEvent): void {
        if (!this.options.enabled || this.stopped) return
        const sessionId = 'sessionId' in event ? event.sessionId : undefined
        if (!sessionId) return

        const eventNamespace = 'namespace' in event ? event.namespace : undefined
        const namespace = eventNamespace
            ?? this.syncEngine.getSession(sessionId)?.namespace
            ?? this.namespaces.get(sessionId)
        if (!namespace) return
        this.namespaces.set(sessionId, namespace)

        if (!this.affectsWidget(event)) return
        this.markDirty(namespace)
    }

    private affectsWidget(event: SyncEvent): boolean {
        switch (event.type) {
        case 'session-added':
        case 'session-updated':
        case 'session-ended':
        case 'session-removed':
            return true
        default:
            return false
        }
    }

    private markDirty(namespace: string): void {
        if (this.debounceTimers.has(namespace)) return
        const timer = setTimeout(() => {
            this.debounceTimers.delete(namespace)
            this.evaluate(namespace)
        }, this.debounceMs)
        this.debounceTimers.set(namespace, timer)
    }

    private evaluate(namespace: string): void {
        if (this.stopped) return
        const fingerprint = this.fingerprint(namespace)
        if (fingerprint === this.lastFingerprint.get(namespace)) return

        const elapsed = this.now() - (this.lastSentAt.get(namespace) ?? 0)
        const wait = Math.max(0, this.throttleMs - elapsed)
        if (wait === 0) {
            this.send(namespace)
            return
        }
        if (this.throttleTimers.has(namespace)) return
        const timer = setTimeout(() => {
            this.throttleTimers.delete(namespace)
            this.send(namespace)
        }, wait)
        this.throttleTimers.set(namespace, timer)
    }

    private send(namespace: string): void {
        if (this.stopped) return
        const fingerprint = this.fingerprint(namespace)
        if (fingerprint === this.lastFingerprint.get(namespace)) return

        this.lastFingerprint.set(namespace, fingerprint)
        this.lastSentAt.set(namespace, this.now())
        void this.sender.sendToNamespace(namespace)
            .then((result) => {
                if (result.sent === 0 && result.failed > 0) {
                    // All devices failed transiently: allow the next event to
                    // retry instead of suppressing it as a duplicate.
                    if (this.lastFingerprint.get(namespace) === fingerprint) {
                        this.lastFingerprint.delete(namespace)
                    }
                }
            })
            .catch((error) => {
                console.error(
                    '[WidgetRefreshNotifier] Silent push failed:',
                    error instanceof Error ? error.message : error
                )
                if (this.lastFingerprint.get(namespace) === fingerprint) {
                    this.lastFingerprint.delete(namespace)
                }
            })
    }

    private fingerprint(namespace: string): string {
        const sessions = this.syncEngine.getSessionsByNamespace(namespace)
        const base = widgetFingerprint(sessions)
        const previewKey = this.options.assistantPreviewFingerprint?.(
            sessions.map((session) => session.id).sort()
        )
        return previewKey ? `${base}|preview:${previewKey}` : base
    }
}

/**
 * Stable, display-only fingerprint of the iOS widget's data contract.
 * Exported for focused tests.
 */
export function widgetFingerprint(sessions: Session[]): string {
    return sessions
        .map((session) => {
            const summary = toSessionSummary(session)
            const status = widgetStatus(summary)
            return [
                session.id,
                status,
                title(session),
                project(session),
                summary.lastUserMessageAt ?? 0,
                summary.pendingRequestsCount ?? 0,
                (summary.pendingRequestKinds ?? []).join(','),
                summary.todoProgress?.completed ?? 0,
                summary.todoProgress?.total ?? 0,
                summary.backgroundTaskCount ?? 0
            ].join(':')
        })
        .sort()
        .join('|')
}

function widgetStatus(summary: ReturnType<typeof toSessionSummary>): string {
    if (!summary.active) return 'done'
    const pending = summary.pendingRequestsCount ?? 0
    if (pending > 0) {
        return `pending:${(summary.pendingRequestKinds ?? []).join(',')}:${pending}`
    }
    if (summary.thinking) return 'working'
    if (summary.metadata?.lifecycleState === 'idle') return 'idle'
    return 'active'
}

function title(session: Session): string {
    const metadata = session.metadata
    const candidates = [
        metadata?.name,
        metadata?.summary?.text,
        metadata?.promptTitle,
        pathTail(metadata?.worktree?.basePath ?? metadata?.path)
    ]
    for (const candidate of candidates) {
        const trimmed = candidate?.trim()
        if (trimmed) return trimmed
    }
    return session.id.slice(0, 8)
}

function project(session: Session): string {
    const metadata = session.metadata
    return pathTail(metadata?.worktree?.basePath ?? metadata?.path) ?? ''
}

function pathTail(path: string | undefined | null): string | null {
    if (!path) return null
    const parts = path.split(/[\\/]/).filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1]! : null
}
