import { Hono } from 'hono'
import type { Context } from 'hono'
import {
    AddTeamMemberRequestSchema,
    CreateTeamRequestSchema,
    CreateTeamTaskRequestSchema,
    TeamHumanMessageRequestSchema,
    TeamSendMessageRequestSchema,
    TeamSpawnMemberRequestSchema,
    TeamTaskUpdateRequestSchema,
    UpdateTeamRequestSchema
} from '@hapi/protocol'

import { TeamService, TeamServiceError } from '../../teams/teamService'
import type { WebAppEnv } from '../middleware/auth'

/**
 * Agent Team API. Registered only when the hub has `teamsEnabled` — with the
 * feature off these paths do not exist (404), matching pre-feature behavior.
 */
export function createTeamsRoutes(teams: TeamService): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/teams', (c) => {
        c.header('Cache-Control', 'no-store')
        // Members included so the sidebar can nest member sessions under a team.
        return c.json({ teams: teams.listTeamsWithMembers(c.get('namespace')) })
    })

    // Feature probe for CLI startup: this route only exists when teams are
    // enabled, so 200 vs 404 tells the CLI whether to register team tools.
    // Must be registered before /teams/:id (Hono matches in order).
    app.get('/teams/feature', (c) => {
        c.header('Cache-Control', 'no-store')
        return c.json({ enabled: true })
    })

    app.get('/teams/by-session/:sessionId', (c) => {
        c.header('Cache-Control', 'no-store')
        const sessionId = c.req.param('sessionId')
        try {
            return c.json(teams.getStatusForSession(sessionId, c.get('namespace')))
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.get('/teams/:id', (c) => {
        c.header('Cache-Control', 'no-store')
        const detail = teams.getTeamDetail(c.req.param('id'), c.get('namespace'))
        if (!detail) {
            return c.json({ error: 'Team not found' }, 404)
        }
        return c.json(detail)
    })

    app.get('/teams/:id/messages', (c) => {
        c.header('Cache-Control', 'no-store')
        const sessionId = c.req.query('sessionId')
        const afterSeq = parsePositiveInt(c.req.query('afterSeq'))
        const limit = parsePositiveInt(c.req.query('limit'))
        try {
            // sessionId present -> CLI/MCP caller (membership checked);
            // absent -> human web reader (namespace-authorized).
            const messages = sessionId
                ? teams.listMessages(sessionId, c.get('namespace'), { afterSeq, limit })
                : teams.listMessagesForHuman(c.get('namespace'), c.req.param('id'), { afterSeq, limit })
            return c.json({ messages })
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.post('/teams/:id/messages', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = TeamSendMessageRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        const teamId = c.req.param('id')
        const membership = teams.resolveMembership(parsed.data.fromSessionId, c.get('namespace'))
        if (!membership || membership.team.id !== teamId) {
            return c.json({ error: 'Session is not a member of this team' }, 404)
        }
        try {
            const message = await teams.sendMessage(parsed.data.fromSessionId, c.get('namespace'), {
                text: parsed.data.text,
                to: parsed.data.to,
                kind: parsed.data.kind,
                inReplyTo: parsed.data.inReplyTo
            })
            c.header('Cache-Control', 'no-store')
            return c.json({ message }, 201)
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.post('/teams/:id/spawn', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = TeamSpawnMemberRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        const teamId = c.req.param('id')
        const membership = teams.resolveMembership(parsed.data.fromSessionId, c.get('namespace'))
        if (!membership || membership.team.id !== teamId) {
            return c.json({ error: 'Session is not a member of this team' }, 404)
        }
        if (!membership.member.role) {
            return c.json({ error: 'Member role is required to spawn peers' }, 403)
        }
        try {
            const result = await teams.spawnMember(parsed.data.fromSessionId, c.get('namespace'), {
                role: parsed.data.role,
                task: parsed.data.task,
                agent: parsed.data.agent,
                model: parsed.data.model,
                sessionType: parsed.data.sessionType,
                worktreeName: parsed.data.worktreeName,
                yolo: parsed.data.yolo
            })
            c.header('Cache-Control', 'no-store')
            return c.json(result, 201)
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.post('/teams/:id/members', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = AddTeamMemberRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        try {
            const result = await teams.addMemberFromSession(c.get('namespace'), c.req.param('id'), {
                sessionId: parsed.data.sessionId,
                role: parsed.data.role,
                task: parsed.data.task
            })
            c.header('Cache-Control', 'no-store')
            return c.json(result, 201)
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.post('/teams/:id/tasks', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = CreateTeamTaskRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        try {
            const task = await teams.createTaskForHuman(c.get('namespace'), c.req.param('id'), {
                title: parsed.data.title,
                assigneeSessionId: parsed.data.assigneeSessionId ?? null
            })
            c.header('Cache-Control', 'no-store')
            return c.json({ task }, 201)
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.patch('/teams/:id/tasks/:taskId', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = TeamTaskUpdateRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        const teamId = c.req.param('id')
        const fromSessionId = parsed.data.fromSessionId ?? null
        if (fromSessionId) {
            const membership = teams.resolveMembership(fromSessionId, c.get('namespace'))
            if (!membership || membership.team.id !== teamId) {
                return c.json({ error: 'Session is not a member of this team' }, 404)
            }
        }
        try {
            const task = await teams.updateTask(
                fromSessionId,
                c.get('namespace'),
                c.req.param('taskId'),
                {
                    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
                    ...(parsed.data.assigneeSessionId !== undefined ? { assigneeSessionId: parsed.data.assigneeSessionId } : {})
                }
            )
            c.header('Cache-Control', 'no-store')
            return c.json({ task })
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.patch('/teams/:id', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = UpdateTeamRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        try {
            const team = teams.updateTeamMeta(c.get('namespace'), c.req.param('id'), {
                ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
                ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
                ...(parsed.data.leadSessionId !== undefined ? { leadSessionId: parsed.data.leadSessionId } : {})
            })
            c.header('Cache-Control', 'no-store')
            return c.json({ team })
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.delete('/teams/:id', (c) => {
        try {
            teams.deleteTeam(c.get('namespace'), c.req.param('id'))
            c.header('Cache-Control', 'no-store')
            return c.json({ ok: true })
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.post('/teams/:id/human-messages', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = TeamHumanMessageRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        try {
            const message = await teams.sendHumanMessage(c.get('namespace'), c.req.param('id'), {
                text: parsed.data.text,
                to: parsed.data.to,
                kind: parsed.data.kind,
                inReplyTo: parsed.data.inReplyTo
            })
            c.header('Cache-Control', 'no-store')
            return c.json({ message }, 201)
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.post('/teams/:id/messages/:seq/dismiss', (c) => {
        const seq = Number.parseInt(c.req.param('seq'), 10)
        if (!Number.isFinite(seq) || seq <= 0) {
            return c.json({ error: 'Invalid message seq' }, 400)
        }
        try {
            const message = teams.dismissHumanMessage(c.get('namespace'), c.req.param('id'), seq)
            c.header('Cache-Control', 'no-store')
            return c.json({ message })
        } catch (error) {
            return teamErrorResponse(c, error)
        }
    })

    app.post('/teams', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = CreateTeamRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }
        c.header('Cache-Control', 'no-store')
        const team = teams.createTeam(c.get('namespace'), parsed.data)
        return c.json({ team }, 201)
    })

    return app
}

function parsePositiveInt(raw: string | undefined): number | undefined {
    if (!raw) return undefined
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) && value > 0 ? value : undefined
}

function teamErrorResponse(c: Context<WebAppEnv>, error: unknown): Response {
    if (error instanceof TeamServiceError) {
        switch (error.code) {
            case 'not_found':
                return c.json({ error: error.message }, 404)
            case 'forbidden':
                return c.json({ error: error.message }, 403)
            case 'budget':
                return c.json({ error: error.message }, 429)
            case 'invalid':
                return c.json({ error: error.message }, 400)
            case 'spawn_failed':
                return c.json({ error: error.message }, 502)
        }
    }
    const message = error instanceof Error ? error.message : 'Unexpected team error'
    return c.json({ error: message }, 502)
}
