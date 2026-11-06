import { Hono } from 'hono'
import { z } from 'zod'

import type { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import type { LiveActivityControl } from '../../live-activity/liveActivityControl'
import type { WebAppEnv } from '../middleware/auth'
import { decodePushKey } from './devices'
import { requireSession, requireSyncEngine } from './guards'

const tokenSchema = z.string().regex(/^[0-9a-fA-F]{16,512}$/, 'token must be hex')
const deviceIdSchema = z.string().min(1).max(128)
const sessionIdSchema = z.string().min(1).max(256)

const registerSchema = z.object({
    token: tokenSchema,
    deviceId: deviceIdSchema,
    sessionId: sessionIdSchema,
    pushKey: z.string()
})

const unregisterSchema = z.object({
    token: tokenSchema.optional(),
    deviceId: deviceIdSchema.optional(),
    sessionId: sessionIdSchema.optional()
}).refine((value) => value.token !== undefined || value.deviceId !== undefined, {
    message: 'token or deviceId is required'
})

/**
 * Live Activity token registration. The iOS app creates the activity and
 * sends its per-activity APNs token here; the hub encrypts future updates
 * with the `pushKey` supplied alongside. The token rows are deliberately
 * separate from `fcm_devices` (different capability, different lifecycle).
 */
export function createLiveActivityRoutes(options: {
    store: Store
    getSyncEngine: () => SyncEngine | null
    getControl?: () => LiveActivityControl | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/live-activities/register', async (c) => {
        if (c.get('role') === 'session-guest') {
            return c.json({ error: 'Guest cannot register Live Activities' }, 403)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = registerSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }
        const pushKey = decodePushKey(parsed.data.pushKey)
        if (!pushKey) {
            return c.json({ error: 'pushKey must be base64 of exactly 32 bytes' }, 400)
        }

        const engine = requireSyncEngine(c, options.getSyncEngine)
        if (engine instanceof Response) return engine
        const access = requireSession(c, engine, parsed.data.sessionId)
        if (access instanceof Response) return access

        const { token, deviceId, sessionId } = parsed.data
        const changed = options.store.liveActivities.upsert(
            c.get('namespace'),
            deviceId,
            sessionId,
            token,
            pushKey.toString('base64')
        )
        const control = options.getControl?.() ?? null
        if (changed) {
            control?.reconcile(sessionId, true)
        }
        return c.json({ ok: true, remote: control?.isRemoteSupported() ?? false })
    })

    app.delete('/live-activities/register', async (c) => {
        if (c.get('role') === 'session-guest') {
            return c.json({ error: 'Guest cannot register Live Activities' }, 403)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = unregisterSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body', issues: parsed.error.flatten() }, 400)
        }
        const namespace = c.get('namespace')
        if (parsed.data.token) {
            options.store.liveActivities.removeByToken(namespace, parsed.data.token)
        } else if (parsed.data.deviceId) {
            options.store.liveActivities.removeForDevice(
                namespace,
                parsed.data.deviceId,
                parsed.data.sessionId
            )
        }
        return c.json({ ok: true })
    })

    return app
}
