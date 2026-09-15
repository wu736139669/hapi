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

function createApp(getNamespace: () => string = () => 'alpha', memoryRoot?: string) {
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
    const runtime: TeamRuntime = {
        resolveSession: (sessionId) => sessions.get(sessionId) ?? null,
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
        sleep: async () => {}
    }
    const service = new TeamService(new TeamStore(':memory:'), (event) => events.push(event), runtime, memoryRoot ? { memoryRoot } : {})
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', getNamespace())
        await next()
    })
    app.route('/api', createTeamsRoutes(service))
    return { app, events, service, delivered }
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

    it('lists and reads team memory files over HTTP', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-team-memory-routes-'))
        try {
            const { app } = createApp(() => 'alpha', dir)
            const teamId = await createTeam(app)
            await mkdir(join(dir, teamId, 'handoffs'), { recursive: true })
            await writeFile(join(dir, teamId, 'handoffs', 'note.md'), '# note')
            // ensureTeamMemory runs fire-and-forget in createTeam; poll briefly.
            let listBody: { files: Array<{ path: string }> } = { files: [] }
            for (let attempt = 0; attempt < 50; attempt++) {
                const list = await app.request(`/api/teams/${teamId}/memory`)
                listBody = await list.json() as { files: Array<{ path: string }> }
                if (listBody.files.some((file) => file.path === 'handoffs/note.md')) break
                await new Promise((resolve) => setTimeout(resolve, 10))
            }
            expect(listBody.files.map((file) => file.path)).toEqual(['charter.md', 'handoffs/note.md'])

            const file = await app.request(`/api/teams/${teamId}/memory/file?path=handoffs/note.md`)
            expect(file.status).toBe(200)
            expect((await file.json() as { content: string }).content).toBe('# note')

            const traversal = await app.request(`/api/teams/${teamId}/memory/file?path=../../etc/passwd`)
            expect(traversal.status).toBe(400)
            const missing = await app.request(`/api/teams/${teamId}/memory/file?path=nope.md`)
            expect(missing.status).toBe(404)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('creates tasks, updates them as the human, and manages the team', async () => {
        const { app, delivered } = createApp()
        const teamId = await createTeam(app)
        const spawned = await app.request(`/api/teams/${teamId}/spawn`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fromSessionId: 'sess-lead', role: 'builder' })
        })
        expect(spawned.status).toBe(201)
        delivered.length = 0

        const created = await app.request(`/api/teams/${teamId}/tasks`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: '写迁移脚本', assigneeSessionId: 'sess-builder' })
        })
        expect(created.status).toBe(201)
        const task = (await created.json() as { task: { id: string } }).task
        expect(delivered).toHaveLength(1)

        const updated = await app.request(`/api/teams/${teamId}/tasks/${task.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'doing', assigneeSessionId: 'sess-builder' })
        })
        expect(updated.status).toBe(200)
        expect((await updated.json() as { task: { status: string } }).task.status).toBe('doing')

        const invalid = await app.request(`/api/teams/${teamId}/tasks/${task.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })
        expect(invalid.status).toBe(400)

        const renamed = await app.request(`/api/teams/${teamId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Auth 重构 v2' })
        })
        expect(renamed.status).toBe(200)
        expect((await renamed.json() as { team: { name: string } }).team.name).toBe('Auth 重构 v2')

        const removed = await app.request(`/api/teams/${teamId}`, { method: 'DELETE' })
        expect(removed.status).toBe(200)
        const missing = await app.request(`/api/teams/${teamId}`)
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
