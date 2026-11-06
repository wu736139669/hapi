import type { LiveActivityApnsPayload } from './liveActivityPayload'

/**
 * Per-token send outcome, same semantics as the alert push transport:
 * `invalid` means the activity token is permanently dead (410 /
 * BadDeviceToken) and the row may be pruned; everything else is transient.
 */
export type LiveActivityPushOutcome = 'sent' | 'invalid' | 'failed'

export type LiveActivityPushRequest = {
    token: string
    payload: LiveActivityApnsPayload
    /** APNs `apns-priority`: 10 for status transitions/end, 5 for count ticks. */
    priority: number
    /** APNs `apns-expiration` in epoch seconds. */
    expiration: number
}

export type LiveActivityPushTransport = {
    sendLiveActivity(request: LiveActivityPushRequest): Promise<LiveActivityPushOutcome>
}
