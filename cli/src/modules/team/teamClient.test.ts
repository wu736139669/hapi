import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'

import {
    fetchTeamStatus,
    formatTeamMessages,
    formatTeamStatus,
    sendTeamMessage,
    type TeamStatusView
} from './teamClient'

type MockResponse = { status: number; data: unknown }

function createHttpMock(responses: MockResponse[]) {
    const calls: Array<{ method: string; url: string; data?: unknown; headers?: Record<string, string> }> = []
    const queue = [...responses]
    const http = {
        post: vi.fn(async (url: string) => {
            calls.push({ method: 'post', url })
            return { status: 200, data: { token: 'jwt-1' } }
        }),
        request: vi.fn(async (config: { method: string; url: string; data?: unknown; headers?: Record<string, string> }) => {
            calls.push({ method: config.method, url: config.url, data: config.data, headers: config.headers })
            const next = queue.shift()
            if (!next) throw new Error('no mocked response left')
            return next
        })
    } as unknown as AxiosInstance
    return { http, calls }
}

const statusBody: TeamStatusView = {
    team: { id: 'team-1', name: 'Refactor auth', status: 'active', leadSessionId: 'sess-lead' },
    me: { sessionId: 'sess-lead', role: 'lead', status: 'idle' },
    members: [{ sessionId: 'sess-lead', role: 'lead', status: 'idle' }],
    tasks: [],
    pendingTasks: [],
    requirements: [],
    budget: { maxMembers: 5, maxMessagesPerMinute: 30, maxChainDepth: 8 }
}

describe('teamClient', () => {
    const originalTeamId = process.env.HAPI_TEAM_ID

    afterEach(() => {
        if (originalTeamId === undefined) {
            delete process.env.HAPI_TEAM_ID
        } else {
            process.env.HAPI_TEAM_ID = originalTeamId
        }
    })

    it('fetches status with bearer auth and returns null on 404', async () => {
        const { http, calls } = createHttpMock([
            { status: 200, data: statusBody },
            { status: 404, data: { error: 'Session is not a member of any team' } }
        ])
        const options = { sessionId: 'sess-lead', apiUrl: 'http://hub.test', accessToken: 'token', http }

        const status = await fetchTeamStatus(options)
        expect(status?.team.id).toBe('team-1')
        expect(calls[1]?.url).toBe('http://hub.test/api/teams/by-session/sess-lead')
        expect(calls[1]?.headers?.Authorization).toBe('Bearer jwt-1')

        const missing = await fetchTeamStatus({ ...options, sessionId: 'sess-out' })
        expect(missing).toBeNull()
    })

    it('sends team messages with the caller session id', async () => {
        const { http, calls } = createHttpMock([
            { status: 201, data: { message: { seq: 7, fromSessionId: 'sess-lead', fromKind: 'session', toSessionId: null, kind: 'chat', text: 'hi', createdAt: 1, meta: null } } }
        ])

        const message = await sendTeamMessage({
            sessionId: 'sess-lead',
            teamId: 'team-1',
            text: 'hi',
            to: 'lead',
            kind: 'status',
            inReplyTo: 3,
            apiUrl: 'http://hub.test',
            accessToken: 'token',
            http
        })

        expect(message.seq).toBe(7)
        expect(calls[1]?.url).toBe('http://hub.test/api/teams/team-1/messages')
        expect(calls[1]?.data).toEqual({
            fromSessionId: 'sess-lead',
            text: 'hi',
            to: 'lead',
            kind: 'status',
            inReplyTo: 3
        })
    })

    it('formats status and message logs for the agent', () => {
        const text = formatTeamStatus(statusBody)
        expect(text).toContain('团队：Refactor auth')
        expect(text).toContain('你的角色：lead')
        expect(text).toContain('你的待办任务：无')

        const log = formatTeamMessages([
            {
                seq: 2,
                fromSessionId: 'sess-builder1234',
                fromKind: 'session',
                toSessionId: null,
                kind: 'task-update',
                text: 'T1 done',
                createdAt: Date.UTC(2026, 0, 1, 10, 0, 0),
                meta: null
            }
        ], 'sess-lead')
        expect(log).toContain('#2')
        expect(log).toContain('sess-bui')
        expect(log).toContain('T1 done')
    })
})
