/**
 * The narrow surface the registration route needs from the notifier. Keeping
 * it separate avoids a route → notifier → route import cycle and lets tests
 * inject a tiny fake.
 */
export type LiveActivityControl = {
    /** True only when the hub is in direct-APNs mode. */
    isRemoteSupported(): boolean
    /** Recompute and push the session's current state (optionally bypassing dedupe). */
    reconcile(sessionId: string, force?: boolean): void
}
