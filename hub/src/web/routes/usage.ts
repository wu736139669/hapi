import { Hono } from 'hono'
import type { UsageSummaryResponse } from '@hapi/protocol/apiTypes'
import type { WebAppEnv } from '../middleware/auth'
import type { Store } from '../../store'
import { getUsageSummary } from '../../sync/usageService'

export function createUsageRoutes(store: Store, refreshUsage?: () => Promise<void>): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/usage/summary', async (c) => {
        if (c.get('namespace') !== 'default') {
            return c.json({ error: 'Usage summary is only available to the hub owner' }, 403)
        }
        const range = c.req.query('range')
        const timeZone = c.req.query('timeZone') ?? 'UTC'
        if (timeZone.length > 100) {
            return c.json({ error: 'Invalid timeZone' }, 400)
        }
        try {
            new Intl.DateTimeFormat('en-US', { timeZone })
        } catch {
            return c.json({ error: 'Invalid timeZone' }, 400)
        }
        // Refresh OpenCode snapshots on demand (debounced by the job): the
        // scan runs in a child process, so waiting here never blocks the hub,
        // and the first page open after a quiet period shows fresh numbers.
        if (refreshUsage) {
            try {
                await refreshUsage()
            } catch {
                // A failed refresh leaves the previous snapshot in place.
            }
        }
        const response: UsageSummaryResponse = getUsageSummary(store, c.get('namespace'), range, timeZone)
        c.header('Cache-Control', 'no-store')
        return c.json(response)
    })

    return app
}
