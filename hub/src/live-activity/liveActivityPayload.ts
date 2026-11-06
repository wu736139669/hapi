import { toSessionSummary } from '@hapi/protocol'

import type { SessionEndReason } from '@hapi/protocol'
import type { Session } from '../sync/syncEngine'
import {
    encryptLiveActivityState,
    type EncryptedLiveActivityState,
    type LiveActivityContentState,
    type LiveActivityStatus
} from './liveActivityContract'

export const LIVE_ACTIVITY_TITLE_LIMIT = 120
export const LIVE_ACTIVITY_PROJECT_LIMIT = 120
const LIVE_ACTIVITY_STALE_SECONDS = 120
const LIVE_ACTIVITY_END_DISMISSAL_SECONDS = 60
export const LIVE_ACTIVITY_PAYLOAD_LIMIT_BYTES = 4096

/**
 * Session title precedence used by web/iOS (`web/src/lib/sessionTitle.ts`).
 * `notifications/sessionInfo.ts` omits `promptTitle`; reusing it here would
 * make the lock-screen title disagree with the app after a reconcile.
 */
export function getLiveActivityTitle(session: Session): string {
    const metadata = session.metadata
    if (metadata?.name?.trim()) return sanitize(metadata.name, LIVE_ACTIVITY_TITLE_LIMIT)
    if (metadata?.summary?.text?.trim()) return sanitize(metadata.summary.text, LIVE_ACTIVITY_TITLE_LIMIT)
    if (metadata?.promptTitle?.trim()) return sanitize(metadata.promptTitle, LIVE_ACTIVITY_TITLE_LIMIT)
    if (metadata?.path) {
        const parts = metadata.path.split('/').filter(Boolean)
        if (parts.length > 0) return sanitize(parts[parts.length - 1]!, LIVE_ACTIVITY_TITLE_LIMIT)
    }
    return session.id.slice(0, 8)
}

export function getLiveActivityProject(session: Session): string {
    const path = session.metadata?.path
    if (!path) return ''
    const parts = path.split('/').filter(Boolean)
    return parts.length > 0 ? sanitize(parts[parts.length - 1]!, LIVE_ACTIVITY_PROJECT_LIMIT) : ''
}

/**
 * The state the lock screen should show, or null when the session is settled
 * and its activity should end. Pending requests win over `working`.
 */
export function buildLiveActivityState(
    session: Session,
    now: number,
    previous?: LiveActivityContentState
): LiveActivityContentState | null {
    if (!session.active) return null
    const summary = toSessionSummary(session)
    const pendingKinds = new Set(summary.pendingRequestKinds)
    let status: LiveActivityStatus | null
    if (summary.pendingRequestsCount > 0) {
        status = pendingKinds.size === 1 && pendingKinds.has('input')
            ? 'needsInput'
            : pendingKinds.size === 1 && pendingKinds.has('permission')
                ? 'needsApproval'
                : 'needsAttention'
    } else {
        status = session.thinking ? 'working' : null
    }
    if (!status) return null

    return {
        status,
        title: getLiveActivityTitle(session),
        project: getLiveActivityProject(session),
        startedAt: startedAtFor(session, previous, now),
        updatedAt: now,
        pendingCount: summary.pendingRequestsCount,
        todoCompleted: summary.todoProgress?.completed ?? 0,
        todoTotal: summary.todoProgress?.total ?? 0,
        backgroundTaskCount: summary.backgroundTaskCount
    }
}

/**
 * Final content for an end push. Uses the last rendered state for identity/
 * timing; `error` is the only reason that maps to a non-done terminal state.
 */
export function buildLiveActivityEndState(args: {
    session?: Session
    previous?: LiveActivityContentState
    reason?: SessionEndReason
    now: number
}): LiveActivityContentState {
    const { session, previous, reason, now } = args
    const title = session ? getLiveActivityTitle(session) : previous?.title ?? 'HAPI session'
    const project = session ? getLiveActivityProject(session) : previous?.project ?? ''
    const startedAt = session
        ? startedAtFor(session, previous, now)
        : previous?.startedAt ?? now
    const summary = session ? toSessionSummary(session) : null
    return {
        status: reason === 'error' ? 'error' : 'done',
        title,
        project,
        startedAt,
        updatedAt: now,
        pendingCount: summary?.pendingRequestsCount ?? previous?.pendingCount ?? 0,
        todoCompleted: summary?.todoProgress?.completed ?? previous?.todoCompleted ?? 0,
        todoTotal: summary?.todoProgress?.total ?? previous?.todoTotal ?? 0,
        backgroundTaskCount: summary?.backgroundTaskCount ?? previous?.backgroundTaskCount ?? 0
    }
}

/**
 * True when only counter fields differ. Status/title/project/startedAt
 * changes are urgent; pending/todo/background counts can wait for the longer
 * throttle window.
 */
export function isCountOnlyChange(
    previous: LiveActivityContentState | undefined,
    next: LiveActivityContentState
): boolean {
    if (!previous) return false
    return previous.status === next.status
        && previous.title === next.title
        && previous.project === next.project
        && previous.startedAt === next.startedAt
}

export function liveActivityStateKey(state: LiveActivityContentState): string {
    return [
        state.status,
        state.title,
        state.project,
        state.startedAt,
        state.pendingCount,
        state.todoCompleted,
        state.todoTotal,
        state.backgroundTaskCount
    ].join('|')
}

export type LiveActivityApnsPayload = {
    aps: Record<string, unknown>
}

/**
 * Encrypts the state and builds the raw APNs body. Returns null when the
 * envelope would exceed APNs' 4 KB limit (skip + log rather than fail the
 * whole fan-out).
 */
export function buildLiveActivityPayload(args: {
    event: 'update' | 'end'
    state: LiveActivityContentState
    pushKeyB64: string
    timestamp: number
}): LiveActivityApnsPayload | null {
    let envelope: EncryptedLiveActivityState
    try {
        envelope = encryptLiveActivityState(
            args.state,
            Buffer.from(args.pushKeyB64, 'base64')
        )
    } catch {
        return null
    }
    const aps: Record<string, unknown> = {
        timestamp: args.timestamp,
        event: args.event,
        'content-state': envelope
    }
    if (args.event === 'update') {
        aps['stale-date'] = args.timestamp + LIVE_ACTIVITY_STALE_SECONDS
    } else {
        aps['dismissal-date'] = args.timestamp + LIVE_ACTIVITY_END_DISMISSAL_SECONDS
    }
    const payload = { aps }
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > LIVE_ACTIVITY_PAYLOAD_LIMIT_BYTES) {
        return null
    }
    return payload
}

function startedAtFor(
    session: Session,
    previous: LiveActivityContentState | undefined,
    now: number
): number {
    // Deliberately no `activeAt`: it moves on every keep-alive and would
    // change the dedupe key, causing a push per heartbeat. Prefer the
    // server's turn boundary; a hub restart with no boundary falls back to
    // the last user message before the previous run's start.
    const activeTurnStartedAt = session.activeTurnStartedAt ?? 0
    if (activeTurnStartedAt > 0) return activeTurnStartedAt
    if ((session.thinkingAt ?? 0) > 0) return session.thinkingAt
    const lastUser = session.lastUserMessageAt ?? 0
    const previousStart = previous?.startedAt ?? 0
    if (lastUser > previousStart) return lastUser
    if (previousStart > 0) return previousStart
    return now
}

/** Strip newlines/control whitespace and cap by code point (no broken graphemes). */
export function sanitize(value: string, limit: number): string {
    const flat = value.replace(/\s+/g, ' ').trim()
    const points = Array.from(flat)
    return points.length > limit ? points.slice(0, limit).join('') : flat
}
