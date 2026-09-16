import { describe, expect, it } from 'vitest'

import type { TeamMessage, TeamRequirement } from '@/types/team'
import { groupMessagesByRequirement } from './teamRequirementGroups'

function requirement(id: string, createdAt: number): TeamRequirement {
    return {
        id,
        teamId: 'team-1',
        title: `需求 ${id}`,
        body: null,
        status: 'open',
        conclusion: null,
        createdBySessionId: null,
        createdAt,
        updatedAt: createdAt
    }
}

function message(seq: number, requirementId?: string): TeamMessage {
    return {
        seq,
        teamId: 'team-1',
        fromKind: 'session',
        fromSessionId: 'sess-a',
        toKind: 'broadcast',
        toSessionId: null,
        kind: 'status',
        text: `m${seq}`,
        meta: requirementId ? { requirementId } : null,
        createdAt: seq
    }
}

describe('groupMessagesByRequirement', () => {
    it('groups messages under their requirement, oldest first', () => {
        const groups = groupMessagesByRequirement(
            [requirement('r2', 200), requirement('r1', 100)],
            [message(1, 'r1'), message(2, 'r2'), message(3, 'r1')]
        )
        expect(groups.map((group) => group.requirement?.id)).toEqual(['r1', 'r2'])
        expect(groups[0]?.messages.map((entry) => entry.seq)).toEqual([1, 3])
        expect(groups[1]?.messages.map((entry) => entry.seq)).toEqual([2])
    })

    it('keeps unknown/unassigned messages in a trailing group', () => {
        const groups = groupMessagesByRequirement(
            [requirement('r1', 100)],
            [message(1), message(2, 'missing'), message(3, 'r1')]
        )
        expect(groups).toHaveLength(2)
        expect(groups[0]?.requirement?.id).toBe('r1')
        expect(groups[1]?.requirement).toBeNull()
        expect(groups[1]?.messages.map((entry) => entry.seq)).toEqual([1, 2])
    })

    it('drops requirements without messages', () => {
        const groups = groupMessagesByRequirement([requirement('r1', 100)], [])
        expect(groups).toEqual([])
    })
})
