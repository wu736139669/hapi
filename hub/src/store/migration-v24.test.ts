import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('schema migration v23 to v24', () => {
    it('adds studio rooms and posts without changing existing sessions', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v24-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        const current = new Store(dbPath)
        current.sessions.getOrCreateSession(
            'tag-1',
            { name: 'Existing' },
            null,
            'default',
            undefined,
            undefined,
            undefined,
            'session-1'
        )
        current.close()

        const legacy = new Database(dbPath)
        legacy.exec('DROP TABLE studio_posts; DROP TABLE studio_rooms; PRAGMA user_version = 23')
        legacy.close()

        const migrated = new Store(dbPath)
        const room = migrated.studios.createOrActivateRoom('session-1', 'default', 'Review room', 'contribute')
        const post = migrated.studios.createPost({
            roomId: room.id,
            guestId: 'guest-12345678',
            authorName: 'Guest',
            kind: 'suggestion',
            text: 'Please add a regression test.'
        })
        expect(room.shareToken.length).toBeGreaterThan(30)
        expect(post.status).toBe('open')
        expect(migrated.sessions.getSessionByNamespace('session-1', 'default')).not.toBeNull()
        migrated.close()
    })
})
