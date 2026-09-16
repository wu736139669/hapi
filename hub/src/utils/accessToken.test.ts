import { describe, expect, it } from 'bun:test'
import { parseAccessToken, resolveAccessToken } from './accessToken'

describe('resolveAccessToken', () => {
    it('resolves a stored user token without treating it as a namespace suffix', () => {
        const lookup = { resolve: (raw: string) => raw === 'hapi_team_secret' ? { namespace: 'member-a' } : null }
        expect(resolveAccessToken('hapi_team_secret', 'shared-base', lookup)).toEqual({
            baseToken: 'hapi_team_secret',
            namespace: 'member-a'
        })
        expect(resolveAccessToken('hapi_team_secret:member-b', 'shared-base', lookup)).toBeNull()
    })

    it('keeps the legacy base-token namespace behavior for the hub owner', () => {
        expect(resolveAccessToken('shared-base:default', 'shared-base')).toEqual({
            baseToken: 'shared-base',
            namespace: 'default'
        })
        expect(parseAccessToken('shared-base:member-a')?.namespace).toBe('member-a')
    })
})
