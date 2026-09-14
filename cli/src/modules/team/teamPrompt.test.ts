import { describe, expect, it } from 'vitest'

import { getTeamPromptBlock, withTeamInstruction } from './teamPrompt'

describe('teamPrompt', () => {
    it('returns null for non-team sessions', () => {
        expect(getTeamPromptBlock('mcp__hapi__', {})).toBeNull()
    })

    it('renders the team block with the flavor tool prefix', () => {
        const env = { HAPI_TEAM_ID: 'team-1', HAPI_TEAM_NAME: 'Refactor auth', HAPI_TEAM_ROLE: 'builder' }
        const block = getTeamPromptBlock('functions.hapi__', env)

        expect(block).toContain('HAPI agent team "Refactor auth"')
        expect(block).toContain('your role: builder')
        expect(block).toContain('functions.hapi__team_status')
        expect(block).toContain('functions.hapi__team_read')
        expect(block).toContain('functions.hapi__team_send')
        expect(block).toContain('functions.hapi__spawn_peer')
        expect(block).not.toContain('mcp__hapi__')
    })

    it('appends the block only when a team id is present', () => {
        expect(withTeamInstruction('BASE', 'mcp__hapi__', {})).toBe('BASE')
        const appended = withTeamInstruction('BASE', 'mcp__hapi__', { HAPI_TEAM_ID: 't' })
        expect(appended.startsWith('BASE\n\n')).toBe(true)
        expect(appended).toContain('mcp__hapi__team_status')
    })
})
