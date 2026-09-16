import { describe, expect, it } from 'bun:test'
import { Store } from './index'

describe('AccessTokenStore', () => {
    it('claims an enrollment invite once and resolves only its namespace', () => {
        const store = new Store(':memory:')
        try {
            const invite = store.accessTokens.createInvite({
                kind: 'enroll',
                now: 1_000,
                expiresInHours: 1
            })
            const claimed = store.accessTokens.claimInvite(invite.invite, 2_000)

            expect(claimed?.namespace).toBe(invite.namespace)
            expect(claimed?.accessToken).toMatch(/^hapi_team_/)
            expect(store.accessTokens.resolve(claimed!.accessToken)?.namespace).toBe(invite.namespace)
            expect(store.accessTokens.claimInvite(invite.invite, 3_000)).toBeNull()
        } finally {
            store.close()
        }
    })

    it('rotates a namespace token without deleting its sessions', () => {
        const store = new Store(':memory:')
        try {
            const enrollment = store.accessTokens.createInvite({
                kind: 'enroll',
                namespace: 'alice',
                now: 1_000
            })
            const oldToken = store.accessTokens.claimInvite(enrollment.invite, 2_000)!
            const recovery = store.accessTokens.createInvite({
                kind: 'recovery',
                namespace: 'alice',
                now: 3_000
            })
            const nextToken = store.accessTokens.claimInvite(recovery.invite, 4_000)!

            expect(nextToken.namespace).toBe('alice')
            expect(store.accessTokens.resolve(oldToken.accessToken)).toBeNull()
            expect(store.accessTokens.resolve(nextToken.accessToken)?.namespace).toBe('alice')
        } finally {
            store.close()
        }
    })

    it('rejects expired invites and the default namespace for user credentials', () => {
        const store = new Store(':memory:')
        try {
            const invite = store.accessTokens.createInvite({
                kind: 'enroll',
                now: 1_000,
                expiresInHours: 1
            })
            expect(store.accessTokens.claimInvite(invite.invite, invite.expiresAt)).toBeNull()
            expect(() => store.accessTokens.createInvite({ kind: 'recovery', namespace: 'default' })).toThrow()
        } finally {
            store.close()
        }
    })
})
