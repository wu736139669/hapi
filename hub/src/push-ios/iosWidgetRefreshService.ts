import type { Store } from '../store'
import type { LiveActivityPushOutcome } from '../live-activity/liveActivityPushTransport'
import type { BackgroundPushTransport } from './backgroundPushTransport'
import type { IosPushSendResult } from './iosPushService'

/** A short APNs expiration: the app fetches current state on wake anyway. */
export const WIDGET_REFRESH_EXPIRATION_SECONDS = 300

/**
 * Silent APNs fan-out for the home-screen widget refresh. No payload content
 * and no per-device push key are used: the app wakes, fetches `/api/sessions`
 * over its authenticated REST connection, and rewrites the App Group snapshot.
 */
export class IosWidgetRefreshService {
    constructor(
        private readonly transport: BackgroundPushTransport,
        private readonly store: Store
    ) {}

    async sendToNamespace(
        namespace: string,
        nowSeconds: number = Math.floor(Date.now() / 1000)
    ): Promise<IosPushSendResult> {
        const devices = this.store.fcm.getDevicesByNamespace(namespace, ['ios'])
        if (devices.length === 0) {
            return { sent: 0, failed: 0, invalidTokens: [] }
        }

        const expiration = nowSeconds + WIDGET_REFRESH_EXPIRATION_SECONDS
        const invalidTokens: string[] = []
        let sent = 0
        let failed = 0

        await Promise.all(devices.map(async (device) => {
            let outcome: LiveActivityPushOutcome
            try {
                outcome = await this.transport.sendBackground({
                    token: device.token,
                    expiration
                })
            } catch (error) {
                // A thrown transport is a bug or transient failure; do not
                // prune the token.
                console.error(
                    '[IosWidgetRefreshService] Transport threw:',
                    error instanceof Error ? error.message : error
                )
                outcome = 'failed'
            }
            if (outcome === 'sent') {
                sent += 1
                return
            }
            failed += 1
            if (outcome === 'invalid') {
                invalidTokens.push(device.token)
                this.store.fcm.removeDeviceByToken(namespace, device.token)
            }
        }))

        return { sent, failed, invalidTokens }
    }
}
