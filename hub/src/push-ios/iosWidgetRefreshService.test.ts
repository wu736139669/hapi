import { afterEach, describe, expect, it } from 'bun:test'

import { Store } from '../store'
import type { BackgroundPushRequest, BackgroundPushTransport } from './backgroundPushTransport'
import { IosWidgetRefreshService, WIDGET_REFRESH_EXPIRATION_SECONDS } from './iosWidgetRefreshService'
import type { LiveActivityPushOutcome } from '../live-activity/liveActivityPushTransport'

class FakeTransport implements BackgroundPushTransport {
    requests: BackgroundPushRequest[] = []
    outcomes = new Map<string, LiveActivityPushOutcome>()
    throws = false

    async sendBackground(request: BackgroundPushRequest): Promise<LiveActivityPushOutcome> {
        if (this.throws) throw new Error('network')
        this.requests.push(request)
        return this.outcomes.get(request.token) ?? 'sent'
    }
}

const IOS_PUSH_KEY = Buffer.alloc(32, 3).toString('base64')

function setup() {
    const store = new Store(':memory:')
    const transport = new FakeTransport()
    const service = new IosWidgetRefreshService(transport, store)
    return { store, transport, service }
}

describe('IosWidgetRefreshService', () => {
    let cleanup: (() => void) | null = null
    afterEach(() => {
        cleanup?.()
        cleanup = null
    })

    it('sends a silent push to every iOS device with a short expiration', async () => {
        const { store, transport, service } = setup()
        cleanup = () => store.close()
        store.fcm.upsertDevice('default', {
            token: 'apns-1',
            platform: 'ios',
            deviceId: 'iphone-1',
            pushKey: IOS_PUSH_KEY
        })
        store.fcm.upsertDevice('default', {
            token: 'apns-2',
            platform: 'ios',
            deviceId: 'iphone-2',
            pushKey: IOS_PUSH_KEY
        })
        store.fcm.upsertDevice('default', {
            token: 'android-1',
            platform: 'phone',
            deviceId: 'pixel-1'
        })

        const result = await service.sendToNamespace('default', 1_700_000_000)
        expect(result).toEqual({ sent: 2, failed: 0, invalidTokens: [] })
        expect(transport.requests).toHaveLength(2)
        expect(transport.requests.map((request) => request.token).sort()).toEqual(['apns-1', 'apns-2'])
        for (const request of transport.requests) {
            expect(request.expiration).toBe(1_700_000_000 + WIDGET_REFRESH_EXPIRATION_SECONDS)
        }
    })

    it('prunes invalid tokens and keeps transient failures', async () => {
        const { store, transport, service } = setup()
        cleanup = () => store.close()
        store.fcm.upsertDevice('default', {
            token: 'gone',
            platform: 'ios',
            deviceId: 'iphone-1',
            pushKey: IOS_PUSH_KEY
        })
        store.fcm.upsertDevice('default', {
            token: 'flaky',
            platform: 'ios',
            deviceId: 'iphone-2',
            pushKey: IOS_PUSH_KEY
        })
        transport.outcomes.set('gone', 'invalid')
        transport.outcomes.set('flaky', 'failed')

        const result = await service.sendToNamespace('default', 1_000)
        expect(result).toEqual({ sent: 0, failed: 2, invalidTokens: ['gone'] })
        expect(store.fcm.getDevicesByNamespace('default', ['ios']).map((device) => device.token)).toEqual(['flaky'])
    })

    it('does not prune a token when the transport throws', async () => {
        const { store, transport, service } = setup()
        cleanup = () => store.close()
        store.fcm.upsertDevice('default', {
            token: 'apns-1',
            platform: 'ios',
            deviceId: 'iphone-1',
            pushKey: IOS_PUSH_KEY
        })
        transport.throws = true

        const result = await service.sendToNamespace('default', 1_000)
        expect(result).toEqual({ sent: 0, failed: 1, invalidTokens: [] })
        expect(store.fcm.getDevicesByNamespace('default', ['ios'])).toHaveLength(1)
    })

    it('is a no-op when the namespace has no iOS devices', async () => {
        const { store, service } = setup()
        cleanup = () => store.close()
        expect(await service.sendToNamespace('missing', 1_000)).toEqual({
            sent: 0,
            failed: 0,
            invalidTokens: []
        })
    })
})
