import { describe, expect, it } from 'bun:test'

import { isTeamTokenRouteAllowed } from './auth'

const TEAM = 'b723ea51-33d3-4866-a4a4-cb0d19fe0372'

describe('team agent token scope', () => {
    it('allows only this team\'s messages/tasks/status', () => {
        expect(isTeamTokenRouteAllowed('GET', '/api/teams/by-session/sess-1', TEAM)).toBe(true)
        expect(isTeamTokenRouteAllowed('GET', `/api/teams/${TEAM}`, TEAM)).toBe(true)
        expect(isTeamTokenRouteAllowed('GET', `/api/teams/${TEAM}/messages`, TEAM)).toBe(true)
        expect(isTeamTokenRouteAllowed('POST', `/api/teams/${TEAM}/messages`, TEAM)).toBe(true)
        expect(isTeamTokenRouteAllowed('PATCH', `/api/teams/${TEAM}/tasks/task-1`, TEAM)).toBe(true)
    })

    it('denies other teams, spawning, token minting, machines and sessions', () => {
        expect(isTeamTokenRouteAllowed('GET', '/api/teams/other-team', TEAM)).toBe(false)
        expect(isTeamTokenRouteAllowed('GET', '/api/teams/other-team/messages', TEAM)).toBe(false)
        expect(isTeamTokenRouteAllowed('POST', `/api/teams/${TEAM}/spawn`, TEAM)).toBe(false)
        expect(isTeamTokenRouteAllowed('POST', `/api/teams/${TEAM}/agent-tokens`, TEAM)).toBe(false)
        expect(isTeamTokenRouteAllowed('DELETE', `/api/teams/${TEAM}`, TEAM)).toBe(false)
        expect(isTeamTokenRouteAllowed('GET', '/api/machines', TEAM)).toBe(false)
        expect(isTeamTokenRouteAllowed('GET', '/api/sessions', TEAM)).toBe(false)
    })
})
