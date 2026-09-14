import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../store'
import { TeamStore } from './teamStore'

/**
 * Zero-impact acceptance: the team store lives in its own file and must never
 * change the main hapi.db (schema version, rows).
 */
describe('Agent Team isolation from the main hub store', () => {
    it('does not touch hapi.db when teams.db is created and used', () => {
        const directory = mkdtempSync(join(tmpdir(), 'hapi-team-isolation-'))
        const dbPath = join(directory, 'hapi.db')
        const teamsDbPath = join(directory, 'teams.db')
        let store: Store | undefined
        let teams: TeamStore | undefined
        try {
            store = new Store(dbPath)
            const session = store.sessions.getOrCreateSession(
                'sess-tag-1',
                { path: '/tmp/project', host: 'test-host' },
                null,
                'default'
            )
            const versionBefore = readUserVersion(dbPath)
            store.close()
            store = undefined

            teams = new TeamStore(teamsDbPath)
            const team = teams.createTeam({ namespace: 'default', name: 'Refactor auth' })
            teams.addMember(team.id, session.id, 'builder')
            teams.appendMessage({
                teamId: team.id,
                fromKind: 'human',
                toKind: 'broadcast',
                text: 'kick off'
            })
            teams.close()
            teams = undefined

            expect(existsSync(teamsDbPath)).toBe(true)

            expect(readUserVersion(dbPath)).toBe(versionBefore)

            store = new Store(dbPath)
            expect(store.sessions.getSession(session.id)?.metadata).toEqual({ path: '/tmp/project', host: 'test-host' })
        } finally {
            teams?.close()
            store?.close()
            rmSync(directory, { recursive: true, force: true })
        }
    })
})

function readUserVersion(dbPath: string): number {
    const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
    try {
        const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
        return row.user_version
    } finally {
        db.close()
    }
}
