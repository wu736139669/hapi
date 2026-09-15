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
        /** Set when the request was authenticated with a team-scoped agent token. */
        teamScope?: { teamId: string }
    }
}

const jwtPayloadSchema = z.object({
    uid: z.number(),
    ns: z.string(),
    sid: z.string().min(1).optional(),
    role: z.literal('session-guest').optional(),
    sht: z.string().min(1).optional()
})

export function createAuthMiddleware(jwtSecret: Uint8Array, options?: {
    isGuestTokenActive?: (shareToken: string) => boolean
    /** Resolve a `hapi_team_*` token to its team scope; null = invalid/expired. */
    resolveTeamAgentToken?: (token: string) => { teamId: string; namespace: string } | null
}): MiddlewareHandler<WebAppEnv> {
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

        // Team-scoped agent tokens: limited to this team's messages/tasks/status.
        // A leaked team token must never reach machines or other sessions.
        if (token.startsWith('hapi_team_')) {
            const scope = options?.resolveTeamAgentToken?.(token)
            if (!scope) {
                return c.json({ error: 'Invalid team token' }, 401)
            }
            if (!isTeamTokenRouteAllowed(c.req.method, path, scope.teamId)) {
                return c.json({ error: 'Team token cannot access this endpoint' }, 403)
            }
            c.set('userId', 0)
            c.set('namespace', scope.namespace)
            c.set('teamScope', { teamId: scope.teamId })
            console.log(`[TeamToken] team=${scope.teamId.slice(0, 8)} token=${token.slice(0, 18)}… ${c.req.method} ${path}`)
            await next()
            return
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
                const forbiddenGuestAction = /\/(fork|rewind|archive|reopen|resume|pin|summary|title-suggestion|switch|migrate-to-acp|permission-mode|collaboration-mode|copilot-agent-mode|model|model-reasoning-effort|effort|service-tier)(?:$|\/)/.test(path)
                const forbiddenGuestModelDiscovery = /\/(codex-models|dsh-models|opencode-models|opencode-reasoning-effort-options|grok-models|grok-reasoning-effort-options|copilot-models|cursor-models|pi-models)(?:$|\/)/.test(path)
                const isSessionMetadataPatch = path.match(/^\/api\/sessions\/[^/]+$/) && c.req.method === 'PATCH'
                const isSessionDelete = path.match(/^\/api\/sessions\/[^/]+$/) && c.req.method === 'DELETE'
                if (forbiddenGuestAction || forbiddenGuestModelDiscovery || isSessionMetadataPatch || isSessionDelete) {
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

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Endpoints a team-scoped agent token may call. Everything else (machines,
 * other sessions, team administration, spawning, token minting) is denied.
 */
export function isTeamTokenRouteAllowed(method: string, path: string, teamId: string): boolean {
    if (!path.startsWith('/api/teams')) {
        return false
    }
    if (method === 'GET' && /^\/api\/teams\/by-session\/[^/]+$/.test(path)) {
        return true
    }
    const id = escapeRegExp(teamId)
    if (method === 'GET' && new RegExp(`^/api/teams/${id}$`).test(path)) {
        return true
    }
    if (method === 'GET' && new RegExp(`^/api/teams/${id}/messages$`).test(path)) {
        return true
    }
    if (method === 'POST' && new RegExp(`^/api/teams/${id}/messages$`).test(path)) {
        return true
    }
    if (method === 'PATCH' && new RegExp(`^/api/teams/${id}/tasks/[^/]+$`).test(path)) {
        return true
    }
    return false
}
