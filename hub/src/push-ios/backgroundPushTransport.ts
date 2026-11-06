import type { LiveActivityPushOutcome } from '../live-activity/liveActivityPushTransport'

/** A silent APNs wake-up; no alert, no encrypted payload. */
export type BackgroundPushRequest = {
    token: string
    /** APNs `apns-expiration`, epoch seconds. */
    expiration: number
}

export type BackgroundPushTransport = {
    sendBackground(request: BackgroundPushRequest): Promise<LiveActivityPushOutcome>
}
