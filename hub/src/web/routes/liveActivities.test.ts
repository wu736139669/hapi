import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT } from 'jose'

import type { Session, SyncEngine } from '../../sync/syncEngine'
import { Store } from '../../store'
import type { LiveActivityControl } from '../../live-activity/liveActivityControl'
import { createAuthMiddleware, type WebAppEnv } from '../middleware/auth'
import { createLiveActivityRoutes } from './liveActivities'

const JWT_SECRET = new TextEncoder().encode('test-secret')
const KEY = Buffer.alloc(32, 7).toString('base64')

async function authHeaders(namespace: string = 'default') {
    const token = await new SignJWT({ uid: 1, ns: namespace })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(JWT_SECRET)
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'sess-1',
        namespace: 'default',
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: 0,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        model: null,
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        ...overrides
    }
}

class FakeSyncEngine {
    readonly sessions = new Map<string, Session>()

    resolveSessionAccess(sessionId: string, namespace: string): {
        ok: true
        sessionId: string
        session: Session
    } | {
        ok: false
        reason: 'not-found' | 'access-denied'
    } {
        const session = this.sessions.get(sessionId)
        if (!session) return { ok: false, reason: 'not-found' }
        if (session.namespace !== namespace) return { ok: false, reason: 'access-denied' }
        return { ok: true, sessionId, session }
    }
}

function createApp(args: {
    store: Store
    engine: FakeSyncEngine
    control?: LiveActivityControl | null
}) {
    const app = new Hono<WebAppEnv>()
    app.use('*', createAuthMiddleware(JWT_SECRET))
    app.route('/api', createLiveActivityRoutes({
        store: args.store,
        getSyncEngine: () => args.engine as unknown as SyncEngine,
        getControl: () => args.control ?? null
    }))
    return app
}

describe('live activity registration routes', () => {
    it('registers a token, stores it, and reconciles only when the row changed', async () => {
        const store = new Store(':memory:')
        const engine = new FakeSyncEngine()
        engine.sessions.set('sess-1', createSession())
        const reconciles: Array<{ sessionId: string; force?: boolean }> = []
        const control: LiveActivityControl = {
            isRemoteSupported: () => true,
            reconcile: (sessionId, force) => reconciles.push({ sessionId, force })
        }
        const app = createApp({ store, engine, control })
        const headers = await authHeaders()
        const body = {
            token: 'aa'.repeat(32),
            deviceId: 'dev-1',
            sessionId: 'sess-1',
            pushKey: KEY
        }

        const first = await app.request('/api/live-activities/register', {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        })
        expect(first.status).toBe(200)
        expect(await first.json()).toEqual({ ok: true, remote: true })
        expect(reconciles).toEqual([{ sessionId: 'sess-1', force: true }])
        expect(store.liveActivities.getForSession('default', 'sess-1')).toHaveLength(1)

        // Same token/key: no forced reconcile.
        const second = await app.request('/api/live-activities/register', {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        })
        expect(second.status).toBe(200)
        expect(reconciles).toHaveLength(1)

        // Rotated activity token: reconcile again.
        const rotated = await app.request('/api/live-activities/register', {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...body, token: 'bb'.repeat(32) })
        })
        expect(rotated.status).toBe(200)
        expect(reconciles).toHaveLength(2)
        expect(store.liveActivities.getForSession('default', 'sess-1')[0]?.token).toBe('bb'.repeat(32))
        store.close()
    })

    it('rejects malformed tokens, keys, and unknown sessions', async () => {
        const store = new Store(':memory:')
        const engine = new FakeSyncEngine()
        engine.sessions.set('sess-1', createSession())
        const app = createApp({ store, engine })
        const headers = await authHeaders()
        const base = {
            token: 'aa'.repeat(32),
            deviceId: 'dev-1',
            sessionId: 'sess-1',
            pushKey: KEY
        }

        for (const body of [
            { ...base, token: 'not-hex' },
            { ...base, pushKey: Buffer.alloc(31).toString('base64') }
        ]) {
            const response = await app.request('/api/live-activities/register', {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            })
            expect(response.status).toBe(400)
        }

        const missing = await app.request('/api/live-activities/register', {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...base, sessionId: 'missing' })
        })
        expect(missing.status).toBe(404)

        const forbidden = await app.request('/api/live-activities/register', {
            method: 'POST',
            headers: await authHeaders('other'),
            body: JSON.stringify(base)
        })
        expect(forbidden.status).toBe(403)
        expect(store.liveActivities.listAll()).toHaveLength(0)
        store.close()
    })

    it('returns remote:false when Live Activities are not enabled on the hub', async () => {
        const store = new Store(':memory:')
        const engine = new FakeSyncEngine()
        engine.sessions.set('sess-1', createSession())
        const app = createApp({ store, engine, control: null })
        const response = await app.request('/api/live-activities/register', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({
                token: 'aa'.repeat(32),
                deviceId: 'dev-1',
                sessionId: 'sess-1',
                pushKey: KEY
            })
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true, remote: false })
        store.close()
    })

    it('unregisters by token or by device/session', async () => {
        const store = new Store(':memory:')
        const engine = new FakeSyncEngine()
        engine.sessions.set('sess-1', createSession())
        const app = createApp({ store, engine })
        const headers = await authHeaders()
        const register = (token: string) => app.request('/api/live-activities/register', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                token,
                deviceId: 'dev-1',
                sessionId: 'sess-1',
                pushKey: KEY
            })
        })
        await register('aa'.repeat(32))
        await register('bb'.repeat(32)) // replaces the first row for this device/session

        const byToken = await app.request('/api/live-activities/register', {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ token: 'bb'.repeat(32) })
        })
        expect(byToken.status).toBe(200)
        expect(store.liveActivities.listAll()).toHaveLength(0)

        await register('cc'.repeat(32))
        const byDevice = await app.request('/api/live-activities/register', {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ deviceId: 'dev-1', sessionId: 'sess-1' })
        })
        expect(byDevice.status).toBe(200)
        expect(store.liveActivities.listAll()).toHaveLength(0)
        store.close()
    })
})
