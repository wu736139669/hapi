import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TEAM_SCHEMA_VERSION, TeamStore } from './teamStore'

function withStore<T>(fn: (store: TeamStore, dbPath: string) => T): T {
    const directory = mkdtempSync(join(tmpdir(), 'hapi-team-store-'))
    const dbPath = join(directory, 'teams.db')
    let store: TeamStore | undefined
    try {
        store = new TeamStore(dbPath)
        return fn(store, dbPath)
    } finally {
        store?.close()
        rmSync(directory, { recursive: true, force: true })
    }
}

describe('TeamStore pending pings', () => {
    it('persists unanswered human pings across reopen', () => {
        const directory = mkdtempSync(join(tmpdir(), 'hapi-team-store-'))
        const dbPath = join(directory, 'teams.db')
        try {
            const first = new TeamStore(dbPath)
            first.setPendingPing({ sessionId: 'sess-a', teamId: 'team-1', at: 123, sawThinking: false })
            first.setPendingPing({ sessionId: 'sess-b', teamId: 'team-1', at: 456, sawThinking: true })
            first.close()

            const second = new TeamStore(dbPath)
            const pings = second.listPendingPings().sort((a, b) => a.sessionId.localeCompare(b.sessionId))
            expect(pings).toEqual([
                { sessionId: 'sess-a', teamId: 'team-1', at: 123, sawThinking: false },
                { sessionId: 'sess-b', teamId: 'team-1', at: 456, sawThinking: true }
            ])

            second.markPendingPingThinking('sess-a')
            second.deletePendingPing('sess-b')
            second.close()

            const third = new TeamStore(dbPath)
            expect(third.listPendingPings()).toEqual([
                { sessionId: 'sess-a', teamId: 'team-1', at: 123, sawThinking: true }
            ])
            third.close()
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
})

describe('TeamStore agent tokens', () => {
    it('stores tokens, reuses the latest live one and drops expired ones', () => {
        const directory = mkdtempSync(join(tmpdir(), 'hapi-team-store-'))
        const dbPath = join(directory, 'teams.db')
        try {
            const store = new TeamStore(dbPath)
            const team = store.createTeam({ namespace: 'default', name: 'Growth' })
            store.insertAgentToken({
                token: 'hapi_team_old',
                teamId: team.id,
                namespace: 'default',
                label: null,
                createdAt: 1_000,
                expiresAt: 2_000
            })
            expect(store.findAgentToken('hapi_team_old')?.teamId).toBe(team.id)
            expect(store.latestAgentToken(team.id, 1_500)?.token).toBe('hapi_team_old')
            // Expired tokens are not reused.
            expect(store.latestAgentToken(team.id, 2_500)).toBeNull()

            store.insertAgentToken({
                token: 'hapi_team_new',
                teamId: team.id,
                namespace: 'default',
                label: 'lead',
                createdAt: 3_000,
                expiresAt: 4_000
            })
            expect(store.latestAgentToken(team.id, 3_500)?.token).toBe('hapi_team_new')

            expect(store.deleteExpiredAgentTokens(2_500)).toBe(1)
            expect(store.findAgentToken('hapi_team_old')).toBeNull()
            store.close()
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
})

describe('TeamStore schema', () => {
    it('creates the v1 schema in a dedicated file', () => {
        withStore((store, dbPath) => {
            expect(store.dbPath).toBe(dbPath)
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
            ).all() as Array<{ name: string }>
            db.close()

            expect(version.user_version).toBe(TEAM_SCHEMA_VERSION)
            const names = tables.map(row => row.name)
            expect(names).toContain('teams')
            expect(names).toContain('team_members')
            expect(names).toContain('team_tasks')
            expect(names).toContain('team_messages')
            expect(names).toContain('team_pending_pings')
            expect(names).toContain('team_agent_tokens')
        })
    })

    it('restricts file permissions to the owner', () => {
        if (process.platform === 'win32') return
        withStore((_store, dbPath) => {
            const mode = statSync(dbPath).mode & 0o777
            expect(mode).toBe(0o600)
        })
    })

    it('refuses to open a newer schema version', () => {
        const directory = mkdtempSync(join(tmpdir(), 'hapi-team-store-newer-'))
        const dbPath = join(directory, 'teams.db')
        try {
            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            db.exec('PRAGMA user_version = 99')
            db.close()
            expect(() => new TeamStore(dbPath)).toThrow(/newer than supported/)
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
})

describe('TeamStore teams', () => {
    it('creates, reads and lists teams per namespace', () => {
        withStore(store => {
            const alpha = store.createTeam({ namespace: 'alpha', name: 'Refactor auth' })
            store.createTeam({ namespace: 'beta', name: 'Other team' })

            expect(alpha.status).toBe('active')
            expect(alpha.leadSessionId).toBeNull()
            expect(store.getTeam(alpha.id, 'alpha')?.name).toBe('Refactor auth')
            expect(store.getTeam(alpha.id, 'beta')).toBeNull()
            expect(store.listTeams('alpha')).toHaveLength(1)
            expect(store.listTeams('beta')).toHaveLength(1)
        })
    })

    it('updates teams and honors archived status', () => {
        withStore(store => {
            const team = store.createTeam({
                namespace: 'alpha',
                name: 'Refactor auth',
                leadSessionId: 'sess-lead',
                config: { template: 'refactor' }
            })

            const updated = store.updateTeam(team.id, 'alpha', {
                status: 'archived',
                config: { template: 'refactor', budget: { maxMembers: 6 } }
            })
            expect(updated?.status).toBe('archived')
            expect(updated?.config).toEqual({ template: 'refactor', budget: { maxMembers: 6 } })
            expect(updated?.leadSessionId).toBe('sess-lead')
            expect(store.updateTeam(team.id, 'beta', { name: 'nope' })).toBeNull()
        })
    })

    it('deletes teams and cascades to members, tasks and messages', () => {
        withStore(store => {
            const team = store.createTeam({ namespace: 'alpha', name: 'Refactor auth' })
            store.addMember(team.id, 'sess-1', 'builder')
            store.createTask({ teamId: team.id, title: 'Task 1' })
            store.appendMessage({ teamId: team.id, fromKind: 'human', toKind: 'broadcast', text: 'hello' })

            expect(store.deleteTeam(team.id, 'alpha')).toBe(true)
            expect(store.deleteTeam(team.id, 'alpha')).toBe(false)
            expect(store.listMembers(team.id)).toHaveLength(0)
            expect(store.listTasks(team.id)).toHaveLength(0)
            expect(store.listMessages(team.id)).toHaveLength(0)
        })
    })
})

describe('TeamStore members', () => {
    it('adds, updates and removes members', () => {
        withStore(store => {
            const team = store.createTeam({ namespace: 'alpha', name: 'Refactor auth' })
            store.addMember(team.id, 'sess-1', 'lead')
            store.addMember(team.id, 'sess-2', 'builder')

            expect(store.listMembers(team.id).map(member => member.role)).toEqual(['lead', 'builder'])
            expect(store.updateMemberStatus(team.id, 'sess-2', 'working')).toBe(true)
            expect(store.listMembers(team.id)[1]?.status).toBe('working')
            expect(store.removeMember(team.id, 'sess-1')).toBe(true)
            expect(store.listMembers(team.id)).toHaveLength(1)
            expect(store.removeMember(team.id, 'sess-missing')).toBe(false)
        })
    })
})

describe('TeamStore tasks', () => {
    it('creates, lists and updates tasks', () => {
        withStore(store => {
            const team = store.createTeam({ namespace: 'alpha', name: 'Refactor auth' })
            const task = store.createTask({
                teamId: team.id,
                title: 'session layer',
                assigneeSessionId: 'sess-1',
                meta: { files: ['src/auth/session.ts'] }
            })

            expect(store.listTasks(team.id)).toHaveLength(1)
            const updated = store.updateTask(task.id, { status: 'done' })
            expect(updated?.status).toBe('done')
            expect(updated?.meta).toEqual({ files: ['src/auth/session.ts'] })
            expect(store.updateTask('task-missing', { status: 'done' })).toBeNull()
        })
    })
})

describe('TeamStore messages', () => {
    it('appends messages with monotonic seq and supports incremental reads', () => {
        withStore(store => {
            const team = store.createTeam({ namespace: 'alpha', name: 'Refactor auth' })
            const first = store.appendMessage({
                teamId: team.id,
                fromKind: 'human',
                toKind: 'broadcast',
                text: 'kick off'
            })
            const second = store.appendMessage({
                teamId: team.id,
                fromKind: 'session',
                fromSessionId: 'sess-1',
                toKind: 'dm',
                toSessionId: 'sess-2',
                kind: 'task-assign',
                text: 'take T1',
                meta: { taskId: 't1' }
            })

            expect(second.seq).toBe(first.seq + 1)
            expect(second.fromSessionId).toBe('sess-1')
            expect(second.toSessionId).toBe('sess-2')
            expect(second.kind).toBe('task-assign')
            expect(store.listMessages(team.id)).toHaveLength(2)
            expect(store.listMessages(team.id, { afterSeq: first.seq })).toHaveLength(1)
            expect(store.listMessages(team.id, { limit: 1 })).toHaveLength(1)
        })
    })
})

describe('TeamStore persistence', () => {
    it('keeps data across reopen', () => {
        withStore((store, dbPath) => {
            const team = store.createTeam({ namespace: 'alpha', name: 'Refactor auth' })
            store.appendMessage({ teamId: team.id, fromKind: 'human', toKind: 'broadcast', text: 'hello' })
            store.close()

            const reopened = new TeamStore(dbPath)
            try {
                expect(reopened.getTeam(team.id, 'alpha')?.name).toBe('Refactor auth')
                expect(reopened.listMessages(team.id)).toHaveLength(1)
            } finally {
                reopened.close()
            }
        })
    })
})
