import { describe, expect, it } from 'vitest'
import type { TeamMessage } from '@/types/team'
import { humanReplyState, pendingHumanDecisions } from './teamMessageState'

function message(overrides: Partial<TeamMessage>): TeamMessage {
    return {
        seq: 1,
        teamId: 'team-1',
        fromKind: 'session',
        fromSessionId: 'sess-builder',
        toKind: 'broadcast',
        toSessionId: null,
        kind: 'chat',
        text: 'hi',
        meta: null,
        createdAt: 0,
        ...overrides,
    }
}

describe('humanReplyState', () => {
    it('ignores regular chat and non-member senders', () => {
        expect(humanReplyState(message({ kind: 'chat' }))).toBeNull()
        expect(humanReplyState(message({ fromKind: 'human', kind: 'decision' }))).toBeNull()
        expect(humanReplyState(message({ fromKind: 'hub', kind: 'decision' }))).toBeNull()
    })

    it('marks decisions pending until the human replies or dismisses them', () => {
        expect(humanReplyState(message({ kind: 'decision' }))).toBe('pending')
        expect(humanReplyState(message({ kind: 'decision', meta: { humanRepliedAt: 123 } }))).toBe('replied')
        expect(humanReplyState(message({ kind: 'decision', meta: { humanDismissedAt: 123 } }))).toBe('dismissed')
    })

    it('treats explicit to: human messages as decisions too', () => {
        expect(humanReplyState(message({ meta: { toHuman: true } }))).toBe('pending')
        expect(humanReplyState(message({ meta: { awaitingHuman: true } }))).toBe('pending')
    })
})

describe('pendingHumanDecisions', () => {
    it('keeps only unreplied decisions, in order', () => {
        const pending = pendingHumanDecisions([
            message({ seq: 1, kind: 'chat' }),
            message({ seq: 2, kind: 'decision' }),
            message({ seq: 3, kind: 'decision', meta: { humanRepliedAt: 1 } }),
            message({ seq: 4, kind: 'decision', meta: { humanDismissedAt: 1 } }),
            message({ seq: 5, meta: { toHuman: true } }),
        ])
        expect(pending.map((entry) => entry.seq)).toEqual([2, 5])
    })
})
