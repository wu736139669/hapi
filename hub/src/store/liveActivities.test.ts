import { describe, expect, it } from 'bun:test'

import { Store } from './index'

const KEY = Buffer.alloc(32, 7).toString('base64')

describe('LiveActivityStore', () => {
    it('upserts by namespace/device/session and reports genuine changes', () => {
        const store = new Store(':memory:')
        expect(store.liveActivities.upsert('default', 'dev-1', 'sess-1', 'aa'.repeat(32), KEY)).toBe(true)
        // Same token/key: no change, so no forced reconcile.
        expect(store.liveActivities.upsert('default', 'dev-1', 'sess-1', 'aa'.repeat(32), KEY)).toBe(false)
        // Rotated activity token: changed.
        expect(store.liveActivities.upsert('default', 'dev-1', 'sess-1', 'bb'.repeat(32), KEY)).toBe(true)

        const rows = store.liveActivities.getForSession('default', 'sess-1')
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            namespace: 'default',
            deviceId: 'dev-1',
            sessionId: 'sess-1',
            token: 'bb'.repeat(32),
            pushKey: KEY
        })
        store.close()
    })

    it('scopes tokens per device and can remove one device or one session', () => {
        const store = new Store(':memory:')
        store.liveActivities.upsert('default', 'dev-1', 'sess-1', 'aa'.repeat(32), KEY)
        store.liveActivities.upsert('default', 'dev-2', 'sess-1', 'bb'.repeat(32), KEY)
        store.liveActivities.upsert('default', 'dev-1', 'sess-2', 'cc'.repeat(32), KEY)

        expect(store.liveActivities.listSessionRefs().sort((a, b) => a.sessionId.localeCompare(b.sessionId)))
            .toEqual([
                { namespace: 'default', sessionId: 'sess-1' },
                { namespace: 'default', sessionId: 'sess-2' }
            ])

        store.liveActivities.removeForDevice('default', 'dev-1', 'sess-1')
        expect(store.liveActivities.getForSession('default', 'sess-1')).toHaveLength(1)
        expect(store.liveActivities.getForSession('default', 'sess-1')[0]?.deviceId).toBe('dev-2')

        store.liveActivities.removeForSession('sess-1')
        expect(store.liveActivities.listForSessionAnyNamespace('sess-1')).toHaveLength(0)
        expect(store.liveActivities.getForSession('default', 'sess-2')).toHaveLength(1)
        store.close()
    })

    it('removes by token and prunes stale rows', () => {
        const store = new Store(':memory:')
        store.liveActivities.upsert('default', 'dev-1', 'sess-1', 'aa'.repeat(32), KEY)
        store.liveActivities.removeByToken('default', 'aa'.repeat(32))
        expect(store.liveActivities.listAll()).toHaveLength(0)

        store.liveActivities.upsert('default', 'dev-1', 'sess-1', 'aa'.repeat(32), KEY)
        store.liveActivities.pruneOlderThan(Date.now() + 1)
        expect(store.liveActivities.listAll()).toHaveLength(0)
        store.close()
    })
})
