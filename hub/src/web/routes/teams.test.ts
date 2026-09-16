import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { SyncEvent } from '@hapi/protocol/types'

import { TeamService, type TeamRuntime, type TeamSessionView } from '../../teams/teamService'
import { TeamStore } from '../../teams/teamStore'
import type { WebAppEnv } from '../middleware/auth'
import { createTeamsRoutes } from './teams'

function createApp(getNamespace: () => string = () => 'alpha') {
    const events: SyncEvent[] = []
    const sessions = new Map<string, TeamSessionView>()
    sessions.set('sess-lead', {
        id: 'sess-lead',
        active: true,
        thinking: false,
        machineId: 'machine-1',
        directory: '/repo',
        flavor: 'claude',
        inWorktree: false
    })
    const delivered: Array<{ sessionId: string; text: string }> = []
    const archived: string[] = []
    const runtime: TeamRuntime = {
        resolveSession: (sessionId) => sessions.get(sessionId) ?? null,
        lastAssistantText: () => null,
        spawnMember: async (input) => {
            const sessionId = `sess-${input.teamRole}`
            sessions.set(sessionId, {
                id: sessionId,
                active: false,
                thinking: false,
                machineId: input.machineId,
                directory: input.directory,
                flavor: input.agent,
                inWorktree: false
            })
            return { ok: true, sessionId }
        },
        deliverPeerMessage: async (input) => {
            delivered.push(input)
        },
        archiveSession: async (sessionId) => {
            archived.push(sessionId)
        },
        sleep: async () => {}
    }
    const service = new TeamService(new TeamStore(':memory:'), (event) => events.push(event), runtime)
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', getNamespace())
        await next()
    })
    app.route('/api', createTeamsRoutes(service))
    return { app, events, service, delivered, archived }
}

describe('Agent Team member routes', () => {
    async function createTeam(app: Hono<WebAppEnv>): Promise<string> {
        const created = await app.request('/api/teams', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Refactor auth', leadSessionId: 'sess-lead' })
        })
        const body = await created.json() as { team: { id: string } }
        return body.team.id
    }

    it('resolves team membership by session', async () => {
        const { app } = createApp()
        const teamId = await createTeam(app)

        const mine = await app.request('/api/teams/by-session/sess-lead')
        expect(mine.status).toBe(200)
        const status = await mine.json() as { team: { id: string }; me: { role: string } }
        expect(status.team.id).toBe(teamId)
        expect(status.me.role).toBe('lead')

        const outsider = await app.request('/api/teams/by-session/sess-nobody')
        expect(outsider.status).toBe(404)
    })

    it('sends team messages with push for directed targets', async () => {
        const { app, delivered } = createApp()
        const teamId = await createTeam(app)
        // The createTeam lead brief is delivered fire-and-forget.
        delivered.length = 0

        const broadcast = await app.request(`/api/teams/${teamId}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', text: 'kick off' })
        })
        expect(broadcast.status).toBe(201)
        expect(delivered).toHaveLength(0)

        const directed = await app.request(`/api/teams/${teamId}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', text: 'go', to: 'sess-lead' })
        })
        expect(directed.status).toBe(400)

        const log = await app.request(`/api/teams/${teamId}/messages?sessionId=sess-lead`)
        expect(log.status).toBe(200)
        const body = await log.json() as { messages: unknown[] }
        expect(body.messages).toHaveLength(1)
    })

    it('spawns members with budget enforcement', async () => {
        const { app } = createApp()
        const teamId = await createTeam(app)

        const spawned = await app.request(`/api/teams/${teamId}/spawn`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', role: 'builder', task: 'do it' })
        })
        expect(spawned.status).toBe(201)
        const body = await spawned.json() as { sessionId: string; taskId: string | null }
        expect(body.sessionId).toBe('sess-builder')
        expect(body.taskId).toBeTruthy()

        const leaderOnly = await app.request('/api/teams/unknown-team/spawn', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', role: 'x' })
        })
        expect(leaderOnly.status).toBe(404)
    })

    it('adopts an existing session as a team member', async () => {
        const { app, delivered } = createApp()
        const teamId = await createTeam(app)
        delivered.length = 0

        const joined = await app.request(`/api/teams/${teamId}/members`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: 'sess-lead', role: 'Builder A', task: 'do it' })
        })
        expect(joined.status).toBe(201)
        const body = await joined.json() as { sessionId: string; taskId: string | null }
        expect(body.sessionId).toBe('sess-lead')
        expect(body.taskId).toBeTruthy()

        const detail = await app.request(`/api/teams/${teamId}`)
        const members = (await detail.json() as { members: Array<{ role: string; sessionId: string }> }).members
        expect(members.some((member) => member.role === 'Builder A')).toBe(true)
    })

    it('updates the team budget through PATCH config', async () => {
        const { app } = createApp()
        const teamId = await createTeam(app)

        const res = await app.request(`/api/teams/${teamId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: { budget: { maxMembers: 2 } } })
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { team: { config: { budget: { maxMembers: number } } } }
        expect(body.team.config.budget.maxMembers).toBe(2)

        // The new cap applies immediately: lead + 1 member fills the team.
        const first = await app.request(`/api/teams/${teamId}/spawn`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', role: 'builder' })
        })
        expect(first.status).toBe(201)
        const second = await app.request(`/api/teams/${teamId}/spawn`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', role: 'reviewer' })
        })
        expect(second.status).toBe(429)
    })

    it('removes a member and can stop the session', async () => {
        const { app, archived } = createApp()
        const teamId = await createTeam(app)
        await app.request(`/api/teams/${teamId}/spawn`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', role: 'builder' })
        })

        const removed = await app.request(`/api/teams/${teamId}/members/sess-builder?stopSession=1`, {
            method: 'DELETE'
        })
        expect(removed.status).toBe(200)
        expect(archived).toEqual(['sess-builder'])

        const detail = await app.request(`/api/teams/${teamId}`)
        const members = (await detail.json() as { members: Array<{ sessionId: string }> }).members
        expect(members.some((member) => member.sessionId === 'sess-builder')).toBe(false)

        // The lead cannot be removed; missing members are a 404.
        const lead = await app.request(`/api/teams/${teamId}/members/sess-lead`, { method: 'DELETE' })
        expect(lead.status).toBe(400)
        const missing = await app.request(`/api/teams/${teamId}/members/sess-nobody`, { method: 'DELETE' })
        expect(missing.status).toBe(404)
    })

    it('updates task status', async () => {
        const { app } = createApp()
        const teamId = await createTeam(app)
        const spawned = await app.request(`/api/teams/${teamId}/spawn`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', role: 'builder', task: 'do it' })
        })
        const { taskId } = await spawned.json() as { taskId: string }

        const updated = await app.request(`/api/teams/${teamId}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', status: 'doing' })
        })
        expect(updated.status).toBe(200)
        expect((await updated.json() as { task: { status: string } }).task.status).toBe('doing')

        const missing = await app.request(`/api/teams/${teamId}/tasks/nope`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', status: 'done' })
        })
        expect(missing.status).toBe(404)
    })
})

describe('Agent Team routes', () => {
    it('starts empty and creates a team', async () => {
        const { app, events } = createApp()

        const empty = await app.request('/api/teams')
        expect(empty.status).toBe(200)
        expect(await empty.json()).toEqual({ teams: [] })

        const created = await app.request('/api/teams', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Refactor auth' })
        })
        expect(created.status).toBe(201)
        const body = await created.json() as { team: { id: string; name: string; namespace: string } }
        expect(body.team.name).toBe('Refactor auth')
        expect(body.team.namespace).toBe('alpha')

        const list = await app.request('/api/teams')
        expect(await list.json()).toEqual({ teams: [expect.objectContaining({ id: body.team.id })] })

        const detail = await app.request(`/api/teams/${body.team.id}`)
        expect(detail.status).toBe(200)
        expect(await detail.json()).toEqual(expect.objectContaining({
            team: expect.objectContaining({ id: body.team.id }),
            members: [],
            tasks: []
        }))

        expect(events).toEqual([{ type: 'team-updated', teamId: body.team.id, namespace: 'alpha' }])
    })

    it('rejects invalid bodies', async () => {
        const { app } = createApp()
        const response = await app.request('/api/teams', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: '' })
        })
        expect(response.status).toBe(400)
    })

    it('does not leak teams across namespaces', async () => {
        let namespace = 'alpha'
        const { app } = createApp(() => namespace)

        const created = await app.request('/api/teams', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Refactor auth' })
        })
        const body = await created.json() as { team: { id: string } }

        namespace = 'beta'
        expect(await (await app.request('/api/teams')).json()).toEqual({ teams: [] })
        expect((await app.request(`/api/teams/${body.team.id}`)).status).toBe(404)

        namespace = 'alpha'
        expect(await (await app.request('/api/teams')).json()).toEqual({
            teams: [expect.objectContaining({ id: body.team.id })]
        })
    })
})

describe('Agent Team decision inbox routes', () => {
    async function createTeam(app: Hono<WebAppEnv>): Promise<string> {
        const created = await app.request('/api/teams', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Growth', leadSessionId: 'sess-lead' })
        })
        const body = await created.json() as { team: { id: string } }
        return body.team.id
    }

    async function sendDecision(app: Hono<WebAppEnv>, teamId: string, text: string): Promise<number> {
        const response = await app.request(`/api/teams/${teamId}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', text, kind: 'decision' })
        })
        expect(response.status).toBe(201)
        const body = await response.json() as { message: { seq: number; meta: Record<string, unknown> | null } }
        expect(body.message.meta?.awaitingHuman).toBe(true)
        return body.message.seq
    }

    it('marks a decision replied when the human answers it with inReplyTo', async () => {
        const { app } = createApp()
        const teamId = await createTeam(app)
        const seq = await sendDecision(app, teamId, '需要确认 A')

        const reply = await app.request(`/api/teams/${teamId}/human-messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: '按建议走', to: 'sess-lead', inReplyTo: seq })
        })
        expect(reply.status).toBe(201)
        const replyBody = await reply.json() as { message: { seq: number } }

        const log = await app.request(`/api/teams/${teamId}/messages?sessionId=sess-lead`)
        const body = await log.json() as { messages: Array<{ seq: number; meta: Record<string, unknown> | null }> }
        const decision = body.messages.find((message) => message.seq === seq)
        expect(typeof decision?.meta?.humanRepliedAt).toBe('number')
        expect(decision?.meta?.humanReplySeq).toBe(replyBody.message.seq)
    })

    it('dismisses a pending decision and rejects non-decisions', async () => {
        const { app } = createApp()
        const teamId = await createTeam(app)
        const seq = await sendDecision(app, teamId, '需要确认 B')

        const dismissed = await app.request(`/api/teams/${teamId}/messages/${seq}/dismiss`, { method: 'POST' })
        expect(dismissed.status).toBe(200)

        const log = await app.request(`/api/teams/${teamId}/messages?sessionId=sess-lead`)
        const body = await log.json() as { messages: Array<{ seq: number; meta: Record<string, unknown> | null }> }
        expect(typeof body.messages.find((message) => message.seq === seq)?.meta?.humanDismissedAt).toBe('number')

        const chat = await app.request(`/api/teams/${teamId}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', text: '普通消息' })
        })
        const chatBody = await chat.json() as { message: { seq: number } }
        const rejected = await app.request(`/api/teams/${teamId}/messages/${chatBody.message.seq}/dismiss`, { method: 'POST' })
        expect(rejected.status).toBe(400)

        const unknown = await app.request(`/api/teams/${teamId}/messages/9999/dismiss`, { method: 'POST' })
        expect(unknown.status).toBe(404)
    })
})
