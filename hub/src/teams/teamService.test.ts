import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'

import { TeamService, TeamServiceError, type TeamRuntime, type TeamSessionView, type TeamSpawnMemberInput } from './teamService'
import { TeamStore } from './teamStore'

function createRuntime(overrides: Partial<TeamRuntime> = {}) {
    const delivered: Array<{ sessionId: string; text: string }> = []
    const spawnInputs: TeamSpawnMemberInput[] = []
    const assistantTexts = new Map<string, string>()
    const sessions = new Map<string, TeamSessionView>()
    const runtime: TeamRuntime = {
        resolveSession: (sessionId) => sessions.get(sessionId) ?? null,
        lastAssistantText: (sessionId) => assistantTexts.get(sessionId) ?? null,
        spawnMember: async (input) => {
            spawnInputs.push(input)
            const sessionId = `sess-${input.teamRole}`
            sessions.set(sessionId, {
                id: sessionId,
                active: true,
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
        sleep: async () => {},
        ...overrides
    }
    return { runtime, sessions, delivered, spawnInputs, assistantTexts }
}

function addCallerSession(sessions: Map<string, TeamSessionView>, sessionId = 'sess-lead'): void {
    sessions.set(sessionId, {
        id: sessionId,
        active: true,
        thinking: false,
        machineId: 'machine-1',
        directory: '/repo',
        flavor: 'claude',
        inWorktree: false
    })
}

async function flushAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('TeamService membership', () => {
    it('derives live member status from session activity', () => {
        const { runtime, sessions } = createRuntime()
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        sessions.set('sess-lead', {
            id: 'sess-lead',
            active: true,
            thinking: true,
            machineId: 'machine-1',
            directory: '/repo',
            flavor: 'claude',
            inWorktree: false
        })
        try {
            const team = service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            const store = service.getTeamDetail(team.id, 'alpha')
            expect(store?.members).toHaveLength(1)

            const working = service.getStatusForSession('sess-lead', 'alpha')
            expect(working.me.status).toBe('working')

            sessions.set('sess-lead', { ...sessions.get('sess-lead')!, thinking: false })
            expect(service.getStatusForSession('sess-lead', 'alpha').me.status).toBe('idle')

            sessions.delete('sess-lead')
            expect(service.getStatusForSession('sess-lead', 'alpha').me.status).toBe('offline')
        } finally {
            service.close()
        }
    })

    it('keeps explicitly blocked members blocked', () => {
        const { runtime, sessions } = createRuntime()
        const store = new TeamStore(':memory:')
        const service = new TeamService(store, () => {}, runtime)
        sessions.set('sess-lead', {
            id: 'sess-lead',
            active: true,
            thinking: false,
            machineId: 'machine-1',
            directory: '/repo',
            flavor: 'claude',
            inWorktree: false
        })
        try {
            const team = service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            store.addMember(team.id, 'sess-builder', 'builder', 'blocked')
            sessions.set('sess-builder', {
                id: 'sess-builder',
                active: true,
                thinking: true,
                machineId: 'machine-1',
                directory: '/repo',
                flavor: 'codex',
                inWorktree: false
            })

            const status = service.getStatusForSession('sess-lead', 'alpha')
            expect(status.members.find((member) => member.sessionId === 'sess-builder')?.status).toBe('blocked')
        } finally {
            service.close()
        }
    })

    it('registers the lead as a member when provided at creation', () => {
        const service = new TeamService(new TeamStore(':memory:'))
        try {
            const team = service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            const status = service.getStatusForSession('sess-lead', 'alpha')
            expect(status.me.role).toBe('lead')
            expect(status.team.id).toBe(team.id)
        } finally {
            service.close()
        }
    })

    it('rejects non-members from status, messages and spawn', async () => {
        const service = new TeamService(new TeamStore(':memory:'))
        try {
            service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            expect(() => service.getStatusForSession('sess-outsider', 'alpha')).toThrow(TeamServiceError)
            await expect(service.sendMessage('sess-outsider', 'alpha', { text: 'hi' })).rejects.toThrow('not a member')
            await expect(service.spawnMember('sess-outsider', 'alpha', { role: 'builder' })).rejects.toThrow('not a member')
        } finally {
            service.close()
        }
    })
})

describe('TeamService messaging', () => {
    function setup(budget?: Record<string, unknown>) {
        const events: SyncEvent[] = []
        const { runtime, sessions, delivered } = createRuntime()
        const store = new TeamStore(':memory:')
        const service = new TeamService(store, (event) => events.push(event), runtime)
        addCallerSession(sessions)
        const team = service.createTeam('alpha', {
            name: 'Refactor auth',
            leadSessionId: 'sess-lead',
            config: budget ? { budget } : undefined
        })
        store.addMember(team.id, 'sess-builder', 'builder')
        sessions.set('sess-builder', {
            id: 'sess-builder',
            active: true,
            thinking: false,
            machineId: 'machine-1',
            directory: '/repo',
            flavor: 'codex',
            inWorktree: false
        })
        // The createTeam lead brief is delivered fire-and-forget; tests assert
        // on messages sent after setup.
        delivered.length = 0
        return { service, store, team, events, delivered, sessions }
    }

    it('keeps broadcasts pull-only and pushes directed messages with a source prefix', async () => {
        const { service, team, delivered } = setup()
        try {
            await service.sendMessage('sess-lead', 'alpha', { text: 'kick off', to: 'all' })
            expect(delivered).toHaveLength(0)
            expect(service.listMessages('sess-lead', 'alpha')).toHaveLength(1)

            await service.sendMessage('sess-lead', 'alpha', { text: 'take T1', to: 'sess-buil' })
            expect(delivered).toHaveLength(1)
            expect(delivered[0]?.sessionId).toBe('sess-builder')
            expect(delivered[0]?.text).toContain('来自 lead')
            expect(delivered[0]?.text).toContain('take T1')

            await service.sendMessage('sess-builder', 'alpha', { text: 'blocked', to: 'lead' })
            expect(delivered).toHaveLength(2)
            expect(delivered[1]?.sessionId).toBe('sess-lead')
        } finally {
            service.close()
        }
    })

    it('lets the human post into the channel and pushes directed messages', async () => {
        const { service, delivered } = setup()
        try {
            const broadcast = await service.sendHumanMessage('alpha', service.listTeams('alpha')[0]!.id, {
                text: 'status check'
            })
            expect(broadcast.fromKind).toBe('human')
            expect(delivered).toHaveLength(0)

            const directed = await service.sendHumanMessage('alpha', broadcast.teamId, {
                text: 'focus on T1',
                to: 'sess-buil'
            })
            expect(directed.toKind).toBe('dm')
            expect(delivered).toHaveLength(1)
            expect(delivered[0]?.sessionId).toBe('sess-builder')
            expect(delivered[0]?.text).toContain('来自 人类')
            expect(delivered[0]?.text).toContain('focus on T1')
        } finally {
            service.close()
        }
    })

    it('rejects human messages for unknown teams', async () => {
        const { service } = setup()
        try {
            await expect(service.sendHumanMessage('alpha', 'missing-team', { text: 'hi' }))
                .rejects.toThrow('Team not found')
        } finally {
            service.close()
        }
    })

    it('routes to="human" as an attention signal without member push', async () => {
        const { service, delivered, events } = setup()
        try {
            const message = await service.sendMessage('sess-builder', 'alpha', { text: 'need a call', to: 'human' })
            expect(message.toKind).toBe('mention')
            expect(message.toSessionId).toBeNull()
            expect(message.meta?.toHuman).toBe(true)
            expect(delivered).toHaveLength(0)
            expect(events.some((event) => event.type === 'team-attention')).toBe(true)
        } finally {
            service.close()
        }
    })

    it('emits attention for decisions and rejects human self-targeting', async () => {
        const { service, events } = setup()
        try {
            await service.sendMessage('sess-builder', 'alpha', { text: 'blocked on api', to: 'lead', kind: 'decision' })
            expect(events.some((event) => event.type === 'team-attention' && event.data.kind === 'decision')).toBe(true)

            await expect(
                service.sendHumanMessage('alpha', service.listTeams('alpha')[0]!.id, { text: 'x', to: 'human' })
            ).rejects.toThrow('Humans cannot target themselves')
        } finally {
            service.close()
        }
    })

    it('rejects self-targeting and ambiguous prefixes', async () => {
        const { service, store, team } = setup()
        try {
            await expect(service.sendMessage('sess-lead', 'alpha', { text: 'x', to: 'sess-lead' }))
                .rejects.toThrow('yourself')
            store.addMember(team.id, 'sess-builder-2', 'builder-2')
            await expect(service.sendMessage('sess-lead', 'alpha', { text: 'x', to: 'sess-buil' }))
                .rejects.toThrow('Ambiguous')
        } finally {
            service.close()
        }
    })

    it('enforces the per-minute message budget', async () => {
        const { service } = setup({ maxMessagesPerMinute: 2 })
        try {
            await service.sendMessage('sess-lead', 'alpha', { text: 'one' })
            await service.sendMessage('sess-lead', 'alpha', { text: 'two' })
            await expect(service.sendMessage('sess-lead', 'alpha', { text: 'three' }))
                .rejects.toThrow('rate limit')
        } finally {
            service.close()
        }
    })

    it('enforces conversation chain depth via inReplyTo', async () => {
        const { service } = setup({ maxChainDepth: 2 })
        try {
            const first = await service.sendMessage('sess-lead', 'alpha', { text: 'q' })
            const second = await service.sendMessage('sess-builder', 'alpha', { text: 'a1', inReplyTo: first.seq })
            const third = await service.sendMessage('sess-lead', 'alpha', { text: 'a2', inReplyTo: second.seq })
            await expect(
                service.sendMessage('sess-builder', 'alpha', { text: 'a3', inReplyTo: third.seq })
            ).rejects.toThrow('chain depth')
        } finally {
            service.close()
        }
    })
})

describe('TeamService spawning', () => {
    it('spawns a member, records a task and delivers the assignment once active', async () => {
        const { runtime, sessions, delivered } = createRuntime()
        const events: SyncEvent[] = []
        const service = new TeamService(new TeamStore(':memory:'), (event) => events.push(event), runtime)
        addCallerSession(sessions)
        try {
            const team = service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            delivered.length = 0
            const result = await service.spawnMember('sess-lead', 'alpha', {
                role: 'builder',
                task: 'Refactor the session layer',
                agent: 'codex'
            })
            expect(result.teamId).toBe(team.id)
            expect(result.sessionId).toBe('sess-builder')
            expect(result.taskId).toBeTruthy()

            await flushAsync()
            expect(delivered).toHaveLength(1)
            expect(delivered[0]?.sessionId).toBe('sess-builder')
            expect(delivered[0]?.text).toContain('你的任务：Refactor the session layer')
            expect(delivered[0]?.text).toContain('团队规范：')
            expect(delivered[0]?.text).toContain('team_send')

            const status = service.getStatusForSession('sess-builder', 'alpha')
            expect(status.pendingTasks).toHaveLength(1)
            expect(status.me.role).toBe('builder')
            expect(events.some((event) => event.type === 'team-updated')).toBe(true)
        } finally {
            service.close()
        }
    })

    it('skips push when the member never becomes active but keeps the task pending', async () => {
        const { runtime, sessions, delivered } = createRuntime()
        runtime.spawnMember = async (input) => {
            const sessionId = 'sess-slow'
            runtime.resolveSession = () => ({
                id: sessionId,
                active: false,
                thinking: false,
                machineId: input.machineId,
                directory: input.directory,
                flavor: input.agent,
                inWorktree: false
            })
            return { ok: true, sessionId }
        }
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        addCallerSession(sessions)
        try {
            service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            delivered.length = 0
            await service.spawnMember('sess-lead', 'alpha', { role: 'builder', task: 'do it' })
            await flushAsync()
            expect(delivered).toHaveLength(0)
            const messages = service.listMessages('sess-lead', 'alpha')
            expect(messages.some((message) => message.kind === 'system')).toBe(true)
        } finally {
            service.close()
        }
    })

    it('passes yolo through to the runtime spawner', async () => {
        const { runtime, sessions, spawnInputs } = createRuntime()
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        addCallerSession(sessions)
        try {
            service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            await service.spawnMember('sess-lead', 'alpha', { role: 'builder', yolo: true })
            expect(spawnInputs[0]?.yolo).toBe(true)
        } finally {
            service.close()
        }
    })

    it('spawned members inherit the caller runtime config', async () => {
        const { runtime, sessions, spawnInputs } = createRuntime()
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        sessions.set('sess-lead', {
            id: 'sess-lead',
            active: true,
            thinking: false,
            machineId: 'machine-1',
            directory: '/repo',
            flavor: 'opencode',
            inWorktree: false,
            model: 'opencode-go/deepseek-v4.1-flash',
            modelReasoningEffort: 'max',
            effort: null,
            permissionMode: 'yolo'
        })
        try {
            service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            await service.spawnMember('sess-lead', 'alpha', { role: 'builder' })
            expect(spawnInputs[0]).toMatchObject({
                agent: 'opencode',
                model: 'opencode-go/deepseek-v4.1-flash',
                modelReasoningEffort: 'max',
                permissionMode: 'yolo',
                yolo: true
            })
        } finally {
            service.close()
        }
    })

    it('explicit spawn fields override the inherited config', async () => {
        const { runtime, sessions, spawnInputs } = createRuntime()
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        sessions.set('sess-lead', {
            id: 'sess-lead',
            active: true,
            thinking: false,
            machineId: 'machine-1',
            directory: '/repo',
            flavor: 'opencode',
            inWorktree: false,
            model: 'opencode-go/deepseek-v4.1-flash',
            modelReasoningEffort: 'max',
            permissionMode: 'yolo'
        })
        try {
            service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            await service.spawnMember('sess-lead', 'alpha', {
                role: 'builder',
                model: 'opencode/other-model',
                modelReasoningEffort: 'low',
                permissionMode: 'acceptEdits'
            })
            expect(spawnInputs[0]).toMatchObject({
                model: 'opencode/other-model',
                modelReasoningEffort: 'low',
                permissionMode: 'acceptEdits',
                yolo: false
            })
        } finally {
            service.close()
        }
    })

    it('enforces member budget and duplicate roles', async () => {
        const { runtime, sessions } = createRuntime()
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        addCallerSession(sessions)
        try {
            service.createTeam('alpha', {
                name: 'Refactor auth',
                leadSessionId: 'sess-lead',
                config: { budget: { maxMembers: 3 } }
            })
            await service.spawnMember('sess-lead', 'alpha', { role: 'builder' })
            await expect(service.spawnMember('sess-lead', 'alpha', { role: 'builder' }))
                .rejects.toThrow('already exists')
            await service.spawnMember('sess-lead', 'alpha', { role: 'reviewer' })
            await expect(service.spawnMember('sess-lead', 'alpha', { role: 'verifier' }))
                .rejects.toThrow('Member limit reached')
        } finally {
            service.close()
        }
    })

    it('propagates spawn failures', async () => {
        const { runtime, sessions } = createRuntime()
        runtime.spawnMember = async () => ({ ok: false, message: 'no machine online' })
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        addCallerSession(sessions)
        try {
            service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            await expect(service.spawnMember('sess-lead', 'alpha', { role: 'builder' }))
                .rejects.toThrow('no machine online')
        } finally {
            service.close()
        }
    })
})

describe('TeamService web task management', () => {
    function setup() {
        const { runtime, sessions, delivered } = createRuntime()
        const store = new TeamStore(':memory:')
        const service = new TeamService(store, () => {}, runtime)
        addCallerSession(sessions)
        const team = service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
        store.addMember(team.id, 'sess-builder', 'builder')
        sessions.set('sess-builder', {
            id: 'sess-builder',
            active: true,
            thinking: false,
            machineId: 'machine-1',
            directory: '/repo',
            flavor: 'codex',
            inWorktree: false
        })
        delivered.length = 0
        return { service, store, team, delivered }
    }

    it('creates tasks from the web, pushes the brief to the assignee', async () => {
        const { service, team, delivered } = setup()
        try {
            const task = await service.createTaskForHuman('alpha', team.id, {
                title: '写迁移脚本',
                assigneeSessionId: 'sess-builder'
            })
            expect(task.status).toBe('todo')
            expect(delivered).toHaveLength(1)
            expect(delivered[0]?.sessionId).toBe('sess-builder')
            expect(delivered[0]?.text).toContain('你有一个新任务：写迁移脚本')

            const messages = service.listMessagesForHuman('alpha', team.id)
            expect(messages.some((message) => message.kind === 'task-assign' && message.fromKind === 'human')).toBe(true)

            await expect(service.createTaskForHuman('alpha', team.id, {
                title: 'bad',
                assigneeSessionId: 'sess-outsider'
            })).rejects.toThrow('not a team member')
        } finally {
            service.close()
        }
    })

    it('updates tasks from the web without a session caller', async () => {
        const { service, team } = setup()
        try {
            const task = await service.createTaskForHuman('alpha', team.id, { title: '审查接口' })
            const updated = await service.updateTask(null, 'alpha', task.id, {
                status: 'doing',
                assigneeSessionId: 'sess-builder'
            })
            expect(updated.status).toBe('doing')
            expect(updated.assigneeSessionId).toBe('sess-builder')

            const messages = service.listMessagesForHuman('alpha', team.id)
            const last = messages[messages.length - 1]
            expect(last?.fromKind).toBe('human')
            expect(last?.text).toContain('负责人 → builder')

            await expect(service.updateTask(null, 'alpha', task.id, { assigneeSessionId: 'sess-outsider' }))
                .rejects.toThrow('not a team member')
            await expect(service.updateTask(null, 'alpha', 'missing', { status: 'done' }))
                .rejects.toThrow('not found')
        } finally {
            service.close()
        }
    })

    it('sets a lead on a leaderless team and delivers the brief', async () => {
        const { runtime, sessions, delivered } = createRuntime()
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        addCallerSession(sessions)
        try {
            const team = service.createTeam('alpha', { name: 'Refactor auth' })
            delivered.length = 0
            const updated = service.updateTeamMeta('alpha', team.id, { leadSessionId: 'sess-lead' })
            expect(updated.leadSessionId).toBe('sess-lead')
            expect(service.getTeamDetail(team.id, 'alpha')?.members.some((m) => m.role === 'lead')).toBe(true)
            await flushAsync()
            expect(delivered.some((message) => message.sessionId === 'sess-lead')).toBe(true)

            expect(() => service.updateTeamMeta('alpha', team.id, { leadSessionId: 'sess-missing' }))
                .toThrow('Lead session not found')
        } finally {
            service.close()
        }
    })

    it('renames, archives and deletes teams from the web', async () => {
        const { service, team } = setup()
        try {
            const renamed = service.updateTeamMeta('alpha', team.id, { name: 'Auth 重构 v2' })
            expect(renamed.name).toBe('Auth 重构 v2')
            const archived = service.updateTeamMeta('alpha', team.id, { status: 'archived' })
            expect(archived.status).toBe('archived')
            await expect(service.sendMessage('sess-builder', 'alpha', { text: 'hi' })).rejects.toThrow('archived')

            service.deleteTeam('alpha', team.id)
            expect(service.getTeamDetail(team.id, 'alpha')).toBeNull()
            expect(() => service.deleteTeam('alpha', team.id)).toThrow('Team not found')
        } finally {
            service.close()
        }
    })
})

describe('TeamService adopt member from session', () => {
    it('adds an existing session as a member, records the task and delivers the brief', async () => {
        const { runtime, sessions, delivered } = createRuntime()
        const store = new TeamStore(':memory:')
        const service = new TeamService(store, () => {}, runtime)
        addCallerSession(sessions)
        sessions.set('sess-worker', {
            id: 'sess-worker',
            active: true,
            thinking: false,
            machineId: 'machine-1',
            directory: '/repo',
            flavor: 'claude',
            inWorktree: false
        })
        try {
            const team = service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            delivered.length = 0
            const result = await service.addMemberFromSession('alpha', team.id, {
                sessionId: 'sess-worker',
                role: 'Builder A',
                task: '实现 token 层'
            })
            expect(result.taskId).toBeTruthy()
            expect(service.getTeamDetail(team.id, 'alpha')?.members.some((m) => m.sessionId === 'sess-worker')).toBe(true)
            await flushAsync()
            expect(delivered.some((message) => message.sessionId === 'sess-worker' && message.text.includes('实现 token 层'))).toBe(true)

            await expect(service.addMemberFromSession('alpha', team.id, {
                sessionId: 'sess-worker',
                role: 'Builder A'
            })).rejects.toThrow('already exists')
            await expect(service.addMemberFromSession('alpha', team.id, {
                sessionId: 'sess-missing',
                role: 'Builder B'
            })).rejects.toThrow('Session not found')
        } finally {
            service.close()
        }
    })
})

describe('TeamService human ping bridging', () => {
    function setup() {
        const { runtime, sessions, delivered, assistantTexts } = createRuntime()
        const store = new TeamStore(':memory:')
        const service = new TeamService(store, () => {}, runtime)
        addCallerSession(sessions)
        const team = service.createTeam('alpha', { name: 'Refactor auth' })
        store.addMember(team.id, 'sess-builder', 'builder')
        sessions.set('sess-builder', {
            id: 'sess-builder',
            active: true,
            thinking: false,
            machineId: 'machine-1',
            directory: '/repo',
            flavor: 'codex',
            inWorktree: false
        })
        delivered.length = 0
        return { service, store, team, assistantTexts }
    }

    it('bridges the member reply into the team log after a human ping', async () => {
        const { service, store, team, assistantTexts } = setup()
        try {
            await service.sendHumanMessage('alpha', team.id, { text: '你好啊', to: 'sess-builder' })
            assistantTexts.set('sess-builder', '你好！我是 Builder，需要我做什么？')

            // Idle before the turn ever started: too early to conclude anything.
            await service.handleMemberActivity('sess-builder', 'alpha', false)
            expect(store.listMessages(team.id).some((message) => (message.meta as { bridged?: boolean } | null)?.bridged === true)).toBe(false)

            await service.handleMemberActivity('sess-builder', 'alpha', true)
            await service.handleMemberActivity('sess-builder', 'alpha', false)

            const bridged = store.listMessages(team.id)
                .filter((message) => (message.meta as { bridged?: boolean } | null)?.bridged === true)
            expect(bridged).toHaveLength(1)
            expect(bridged[0]?.fromSessionId).toBe('sess-builder')
            expect(bridged[0]?.text).toContain('你好！我是 Builder')
        } finally {
            service.close()
        }
    })

    it('does not bridge when the member already replied via team_send', async () => {
        const { service, store, team, assistantTexts } = setup()
        try {
            await service.sendHumanMessage('alpha', team.id, { text: 'hi', to: 'sess-builder' })
            await service.sendMessage('sess-builder', 'alpha', { text: '直接答复', to: 'human' })
            assistantTexts.set('sess-builder', 'internal text')
            await service.handleMemberActivity('sess-builder', 'alpha', true)
            await service.handleMemberActivity('sess-builder', 'alpha', false)
            expect(store.listMessages(team.id).some((message) => (message.meta as { bridged?: boolean } | null)?.bridged === true)).toBe(false)
        } finally {
            service.close()
        }
    })

    it('keeps the pending ping across a hub restart', async () => {
        const { runtime, sessions, assistantTexts } = createRuntime()
        const store = new TeamStore(':memory:')
        const beforeRestart = new TeamService(store, () => {}, runtime)
        try {
            addCallerSession(sessions)
            const team = beforeRestart.createTeam('alpha', { name: 'Refactor auth' })
            store.addMember(team.id, 'sess-builder', 'builder')
            sessions.set('sess-builder', {
                id: 'sess-builder',
                active: true,
                thinking: false,
                machineId: 'machine-1',
                directory: '/repo',
                flavor: 'codex',
                inWorktree: false
            })

            await beforeRestart.sendHumanMessage('alpha', team.id, { text: '你好', to: 'sess-builder' })
            assistantTexts.set('sess-builder', '收到，这就开始')

            // A fresh TeamService (hub restart) must still bridge the reply.
            const afterRestart = new TeamService(store, () => {}, runtime)
            await afterRestart.handleMemberActivity('sess-builder', 'alpha', true)
            await afterRestart.handleMemberActivity('sess-builder', 'alpha', false)

            const bridged = store.listMessages(team.id)
                .filter((message) => (message.meta as { bridged?: boolean } | null)?.bridged === true)
            expect(bridged).toHaveLength(1)
            expect(bridged[0]?.text).toContain('收到，这就开始')
        } finally {
            beforeRestart.close()
        }
    })
})

describe('TeamService decision inbox', () => {
    function setup() {
        const { runtime, sessions } = createRuntime()
        const store = new TeamStore(':memory:')
        const service = new TeamService(store, () => {}, runtime)
        addCallerSession(sessions)
        const team = service.createTeam('alpha', { name: 'Growth' })
        store.addMember(team.id, 'sess-builder', 'builder')
        sessions.set('sess-builder', {
            id: 'sess-builder',
            active: true,
            thinking: false,
            machineId: 'machine-1',
            directory: '/repo',
            flavor: 'codex',
            inWorktree: false
        })
        return { service, store, team }
    }

    it('flags member decisions as awaiting the human', async () => {
        const { service, store, team } = setup()
        try {
            await service.sendMessage('sess-builder', 'alpha', { text: '需要确认 A', kind: 'decision' })
            const decision = store.listMessages(team.id).find((message) => message.kind === 'decision')
            expect(decision?.meta?.awaitingHuman).toBe(true)
        } finally {
            service.close()
        }
    })

    it('marks the decision replied when the human answers it', async () => {
        const { service, store, team } = setup()
        try {
            await service.sendMessage('sess-builder', 'alpha', { text: '需要确认 B', kind: 'decision' })
            const decision = store.listMessages(team.id).find((message) => message.kind === 'decision')
            expect(decision).toBeTruthy()

            await service.sendHumanMessage('alpha', team.id, {
                text: '按建议走',
                to: 'sess-builder',
                inReplyTo: decision!.seq
            })

            const updated = store.getMessage(team.id, decision!.seq)
            expect(typeof updated?.meta?.humanRepliedAt).toBe('number')
            expect(updated?.meta?.humanReplySeq).toBeTypeOf('number')
        } finally {
            service.close()
        }
    })

    it('dismisses a decision without replying', () => {
        const { service, store, team } = setup()
        try {
            const decision = store.appendMessage({
                teamId: team.id,
                fromKind: 'session',
                fromSessionId: 'sess-builder',
                toKind: 'broadcast',
                kind: 'decision',
                text: '需要确认 C',
                meta: { fromRole: 'builder', awaitingHuman: true }
            })
            const dismissed = service.dismissHumanMessage('alpha', team.id, decision.seq)
            expect(typeof dismissed.meta?.humanDismissedAt).toBe('number')
        } finally {
            service.close()
        }
    })

    it('refuses to dismiss a regular chat message', () => {
        const { service, store, team } = setup()
        try {
            const chat = store.appendMessage({
                teamId: team.id,
                fromKind: 'session',
                fromSessionId: 'sess-builder',
                toKind: 'broadcast',
                kind: 'chat',
                text: '普通消息'
            })
            expect(() => service.dismissHumanMessage('alpha', team.id, chat.seq)).toThrow(TeamServiceError)
        } finally {
            service.close()
        }
    })
})

describe('TeamService lead brief', () => {
    it('delivers a lead brief when the team is created with a lead session', async () => {
        const { runtime, sessions, delivered } = createRuntime()
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        addCallerSession(sessions)
        try {
            service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            await flushAsync()
            expect(delivered).toHaveLength(1)
            expect(delivered[0]?.sessionId).toBe('sess-lead')
            expect(delivered[0]?.text).toContain('Lead')
        } finally {
            service.close()
        }
    })
})

describe('TeamService member down handling', () => {
    function setup() {
        const { runtime, sessions, delivered } = createRuntime()
        const events: SyncEvent[] = []
        const store = new TeamStore(':memory:')
        const service = new TeamService(store, (event) => events.push(event), runtime)
        addCallerSession(sessions)
        const team = service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
        store.addMember(team.id, 'sess-builder', 'builder', 'working')
        sessions.set('sess-builder', {
            id: 'sess-builder',
            active: true,
            thinking: false,
            machineId: 'machine-1',
            directory: '/repo',
            flavor: 'codex',
            inWorktree: false
        })
        delivered.length = 0
        return { service, store, team, sessions, delivered, events }
    }

    it('marks the member offline, logs it and wakes the lead', async () => {
        const { service, store, team, delivered } = setup()
        try {
            await service.handleSessionDown('sess-builder', 'alpha', 'completed')

            const member = service.getTeamDetail(team.id, 'alpha')?.members.find((m) => m.sessionId === 'sess-builder')
            expect(member?.status).toBe('offline')
            const systemMessage = store.listMessages(team.id).find((message) => message.kind === 'system')
            expect(systemMessage?.text).toContain('builder')
            expect(systemMessage?.text).toContain('已离线')
            expect(delivered).toHaveLength(1)
            expect(delivered[0]?.sessionId).toBe('sess-lead')
            expect(delivered[0]?.text).toContain('已离线')
        } finally {
            service.close()
        }
    })

    it('dedupes repeated down events and ignores non-members', async () => {
        const { service, delivered } = setup()
        try {
            await service.handleSessionDown('sess-builder', 'alpha', 'completed')
            await service.handleSessionDown('sess-builder', 'alpha', 'completed')
            expect(delivered).toHaveLength(1)

            await service.handleSessionDown('sess-outsider', 'alpha')
            expect(delivered).toHaveLength(1)
        } finally {
            service.close()
        }
    })

    it('notifies the human when the lead session goes down', async () => {
        const { service, events } = setup()
        try {
            await service.handleSessionDown('sess-lead', 'alpha', 'terminated')
            expect(events.some((event) => event.type === 'team-attention' && event.data.text.includes('已离线'))).toBe(true)
        } finally {
            service.close()
        }
    })
})

describe('TeamService task updates', () => {
    it('updates tasks and pushes done/blocked states to the lead', async () => {
        const { runtime, sessions, delivered } = createRuntime()
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        addCallerSession(sessions)
        try {
            const team = service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            const spawned = await service.spawnMember('sess-lead', 'alpha', { role: 'builder', task: 'do it' })
            delivered.length = 0

            const updated = await service.updateTask('sess-builder', 'alpha', spawned.taskId!, {
                status: 'done',
                deliverable: 'branch hapi-builder; tests pass'
            })
            expect(updated.status).toBe('done')
            expect(updated.teamId).toBe(team.id)
            expect(delivered).toHaveLength(1)
            expect(delivered[0]?.sessionId).toBe('sess-lead')
            expect(delivered[0]?.text).toContain('done')

            await expect(
                service.updateTask('sess-builder', 'alpha', 'missing-task', { status: 'done' })
            ).rejects.toThrow('not found')
        } finally {
            service.close()
        }
    })

    it('requires a deliverable when a member marks a task done', async () => {
        const { runtime, sessions } = createRuntime()
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        addCallerSession(sessions)
        try {
            service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            const spawned = await service.spawnMember('sess-lead', 'alpha', { role: 'builder', task: 'do it' })
            await expect(
                service.updateTask('sess-builder', 'alpha', spawned.taskId!, { status: 'done' })
            ).rejects.toThrow('交付物')

            // Humans may close tasks freely.
            const closed = await service.updateTask(null, 'alpha', spawned.taskId!, { status: 'done' })
            expect(closed.status).toBe('done')
        } finally {
            service.close()
        }
    })

    it('requires dependencies to be done before a member can progress', async () => {
        const { runtime, sessions } = createRuntime()
        const service = new TeamService(new TeamStore(':memory:'), () => {}, runtime)
        addCallerSession(sessions)
        try {
            const team = service.createTeam('alpha', { name: 'Refactor auth', leadSessionId: 'sess-lead' })
            const first = await service.spawnMember('sess-lead', 'alpha', { role: 'builder', task: 'design' })
            const second = await service.createTaskForHuman('alpha', team.id, {
                title: 'implement',
                dependsOn: [first.taskId!]
            })
            await expect(
                service.updateTask('sess-builder', 'alpha', second.id, { status: 'doing' })
            ).rejects.toThrow('依赖未完成')
            await expect(
                service.updateTask('sess-builder', 'alpha', second.id, { dependsOn: ['not-a-task'] })
            ).rejects.toThrow('依赖任务不存在')

            await service.updateTask('sess-builder', 'alpha', first.taskId!, {
                status: 'done',
                deliverable: 'design doc'
            })
            const progressed = await service.updateTask('sess-builder', 'alpha', second.id, { status: 'doing' })
            expect(progressed.status).toBe('doing')
        } finally {
            service.close()
        }
    })
})

describe('TeamService agent tokens', () => {
    it('issues, resolves and reuses team-scoped tokens', () => {
        const service = new TeamService(new TeamStore(':memory:'), () => {}, createRuntime().runtime)
        try {
            const team = service.createTeam('alpha', { name: 'Refactor auth' })
            const issued = service.issueAgentToken('alpha', team.id, { label: 'lead' })
            expect(issued.token.startsWith('hapi_team_')).toBe(true)
            expect(service.resolveAgentToken(issued.token)).toEqual({ teamId: team.id, namespace: 'alpha' })
            expect(service.resolveAgentToken('hapi_team_nope')).toBeNull()
            expect(service.resolveAgentToken('not-a-team-token')).toBeNull()
            expect(service.getOrCreateAgentToken('alpha', team.id)).toBe(issued.token)
        } finally {
            service.close()
        }
    })

    it('rejects expired tokens', () => {
        const store = new TeamStore(':memory:')
        const service = new TeamService(store, () => {}, null)
        try {
            const team = service.createTeam('alpha', { name: 'Refactor auth' })
            const issued = service.issueAgentToken('alpha', team.id)
            const record = store.findAgentToken(issued.token)
            expect(record).not.toBeNull()
            store.insertAgentToken({ ...record!, expiresAt: Date.now() - 1000 })
            expect(service.resolveAgentToken(issued.token)).toBeNull()
        } finally {
            service.close()
        }
    })
})

describe('TeamService settings', () => {
    it('merges budget updates into the team config', () => {
        const service = new TeamService(new TeamStore(':memory:'), () => {}, createRuntime().runtime)
        try {
            const team = service.createTeam('alpha', {
                name: 'Refactor auth',
                config: { template: 'refactor', budget: { maxMessagesPerMinute: 10 } }
            })
            const updated = service.updateTeamMeta('alpha', team.id, { budget: { maxMembers: 12 } })
            expect(updated.config).toMatchObject({
                template: 'refactor',
                budget: { maxMessagesPerMinute: 10, maxMembers: 12 }
            })
        } finally {
            service.close()
        }
    })
})
