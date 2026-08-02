import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { getConfiguration } from '../../configuration'
import { getSettingsFile, readSettings } from '../../config/settings'

/**
 * Connection info for the web UI's "switch connection" affordance:
 * the public URL (configured via HAPI_PUBLIC_URL) and an optional LAN URL
 * (`lanUrl` in settings.json) for same-network direct access.
 */
export function createServerInfoRoutes(dataDir: string): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/server/switch-info', async (c) => {
        const configuration = getConfiguration()
        const settings = await readSettings(getSettingsFile(dataDir))
        const lanUrl = typeof settings?.lanUrl === 'string' && settings.lanUrl.trim()
            ? settings.lanUrl.trim()
            : null
        return c.json({
            publicUrl: configuration.publicUrl || null,
            lanUrl
        })
    })

    return app
}
