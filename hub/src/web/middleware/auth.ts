import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { jwtVerify } from 'jose'

export type WebAppEnv = {
    Variables: {
        userId: number
        namespace: string
        sessionId?: string
        role?: 'session-guest'
        shareToken?: string
    }
}

const jwtPayloadSchema = z.object({
    uid: z.number(),
    ns: z.string(),
    sid: z.string().min(1).optional(),
    role: z.literal('session-guest').optional(),
    sht: z.string().min(1).optional()
})

export function createAuthMiddleware(jwtSecret: Uint8Array, options?: { isGuestTokenActive?: (shareToken: string) => boolean }): MiddlewareHandler<WebAppEnv> {
    return async (c, next) => {
        const path = c.req.path
        if (path === '/api/auth' || path === '/api/bind' || path.startsWith('/api/public/studios/') || path.startsWith('/api/public/session-shares/')) {
            await next()
            return
        }

        const authorization = c.req.header('authorization')
        const tokenFromHeader = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
        const tokenFromQuery = path === '/api/events' ? c.req.query().token : undefined
        const token = tokenFromHeader ?? tokenFromQuery

        if (!token) {
            return c.json({ error: 'Missing authorization token' }, 401)
        }

        try {
            const verified = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] })
            const parsed = jwtPayloadSchema.safeParse(verified.payload)
            if (!parsed.success) {
                return c.json({ error: 'Invalid token payload' }, 401)
            }

            c.set('userId', parsed.data.uid)
            c.set('namespace', parsed.data.ns)
            if (parsed.data.role === 'session-guest' && parsed.data.sid) {
                if (!parsed.data.sht || options?.isGuestTokenActive?.(parsed.data.sht) !== true) {
                    return c.json({ error: 'Share revoked or expired' }, 401)
                }
                c.set('role', parsed.data.role)
                c.set('sessionId', parsed.data.sid)
                c.set('shareToken', parsed.data.sht)
                if (!(path === '/api/events' || path === '/api/sessions' || path.startsWith('/api/sessions/'))) {
                    return c.json({ error: 'Guest access is limited to the shared session' }, 403)
                }
                const forbiddenGuestAction = /\/(fork|rewind|archive|reopen|resume|pin|summary|title-suggestion|switch|migrate-to-acp)(?:$|\/)/.test(path)
                const isSessionMetadataPatch = path.match(/^\/api\/sessions\/[^/]+$/) && c.req.method === 'PATCH'
                const isSessionDelete = path.match(/^\/api\/sessions\/[^/]+$/) && c.req.method === 'DELETE'
                if (forbiddenGuestAction || isSessionMetadataPatch || isSessionDelete) {
                    return c.json({ error: 'Guest cannot perform this action' }, 403)
                }
            }
            await next()
            return
        } catch {
            return c.json({ error: 'Invalid token' }, 401)
        }
    }
}
