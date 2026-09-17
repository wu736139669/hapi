import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeUsageSessionReport } from '@hapi/protocol/usage'
import { collectOpencodeUsageReports, startOpencodeUsageScanner } from './opencodeUsageScanner'

// The real reader needs Bun's sqlite built-in, which this vitest (node)
// environment lacks; the reader itself is covered by the hub's bun tests.
// This suite only exercises the scanner's collection/filter/timer plumbing.
const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    read: vi.fn()
}))

vi.mock('@hapi/protocol/opencodeUsage', () => ({
    resolveOpencodeDbPath: () => '/tmp/hapi-opencode-scanner-test/opencode.db',
    listOpencodeSessionIds: (...args: unknown[]) => mocks.list(...args),
    readOpencodeUsageForSessions: (...args: unknown[]) => mocks.read(...args)
}))

const row = {
    day: '2026-09-17',
    model: 'opencode-go/deepseek-v4.1-flash',
    inputTokens: 1_000,
    outputTokens: 15,
    cacheReadTokens: 900,
    cacheCreationTokens: 0,
    requests: 1
}

afterEach(() => {
    vi.useRealTimers()
    mocks.list.mockReset()
    mocks.read.mockReset()
})

describe('opencode usage scanner', () => {
    it('collects reports only for sessions with usage rows', async () => {
        mocks.list.mockResolvedValue(['ses_a', 'ses_b'])
        mocks.read.mockResolvedValue(new Map([
            ['ses_a', { rows: [row], messages: 3 }],
            ['ses_b', { rows: [], messages: 0 }]
        ]))

        await expect(collectOpencodeUsageReports('/tmp/opencode.db')).resolves.toEqual([
            { opencodeSessionId: 'ses_a', rows: [row] }
        ])
    })

    it('reports on its interval and stops cleanly', async () => {
        vi.useFakeTimers()
        mocks.list.mockResolvedValue(['ses_a'])
        mocks.read.mockResolvedValue(new Map([['ses_a', { rows: [row], messages: 3 }]]))
        const reports: OpencodeUsageSessionReport[][] = []
        const scanner = startOpencodeUsageScanner({
            dbPath: '/tmp/opencode.db',
            initialDelayMs: 0,
            intervalMs: 1_000,
            report: (sessions) => reports.push(sessions)
        })

        await vi.advanceTimersByTimeAsync(1)
        expect(reports).toEqual([[{ opencodeSessionId: 'ses_a', rows: [row] }]])

        await vi.advanceTimersByTimeAsync(1_000)
        expect(reports).toHaveLength(2)

        scanner.stop()
        await vi.advanceTimersByTimeAsync(5_000)
        expect(reports).toHaveLength(2)
    })

    it('stays silent when the store has no sessions', async () => {
        vi.useFakeTimers()
        mocks.list.mockResolvedValue([])
        const reports: OpencodeUsageSessionReport[][] = []
        const scanner = startOpencodeUsageScanner({
            dbPath: '/tmp/opencode.db',
            initialDelayMs: 0,
            intervalMs: 1_000,
            report: (sessions) => reports.push(sessions)
        })

        await vi.advanceTimersByTimeAsync(2_000)
        expect(reports).toHaveLength(0)
        expect(mocks.read).not.toHaveBeenCalled()
        scanner.stop()
    })
})
