import { describe, expect, it } from 'vitest'

import type { TeamMessage, TeamRequirement, TeamTask } from '@/types/team'
import { requirementOutcome, selectMilestones } from './requirementSummary'

function requirement(conclusion: string | null): TeamRequirement {
    return {
        id: 'r1',
        teamId: 'team-1',
        title: '把搜索修好',
        body: '把搜索修好',
        status: conclusion ? 'done' : 'doing',
        conclusion,
        createdBySessionId: null,
        createdAt: 1,
        updatedAt: 1
    }
}

function task(status: TeamTask['status'], deliverable?: string): TeamTask {
    return {
        id: `t-${status}-${deliverable ?? ''}`,
        teamId: 'team-1',
        title: '实现',
        status,
        assigneeSessionId: null,
        meta: deliverable ? { deliverable } : null,
        createdAt: 1,
        updatedAt: 1
    }
}

function message(seq: number, overrides: Partial<TeamMessage> = {}): TeamMessage {
    return {
        seq,
        teamId: 'team-1',
        fromKind: 'session',
        fromSessionId: 'sess-a',
        toKind: 'broadcast',
        toSessionId: null,
        kind: 'status',
        text: `m${seq}`,
        meta: null,
        createdAt: seq,
        ...overrides
    }
}

describe('requirementOutcome', () => {
    it('prefers the lead conclusion', () => {
        const outcome = requirementOutcome(requirement('已修复，测试全绿'), [task('done', 'branch x')], [])
        expect(outcome.kind).toBe('conclusion')
    })

    it('derives a result from task states when there is no conclusion', () => {
        const outcome = requirementOutcome(requirement(null), [task('done', 'branch x'), task('doing')], [])
        expect(outcome).toMatchObject({ kind: 'tasks', doneTasks: 1, totalTasks: 2, deliverable: 'branch x' })
    })

    it('falls back to none without tasks or conclusion', () => {
        expect(requirementOutcome(requirement(null), [], [message(1)]).kind).toBe('none')
    })
})

describe('selectMilestones', () => {
    it('keeps human messages, decisions, hub notices and finished tasks', () => {
        const milestones = selectMilestones([
            message(1, { fromKind: 'human' }),
            message(2, { kind: 'decision' }),
            message(3, { kind: 'task-update', meta: { status: 'doing' } }),
            message(4, { kind: 'task-update', meta: { status: 'done' } }),
            message(5, { kind: 'task-update', text: '任务「x」→ blocked（dev）' }),
            message(6, { fromKind: 'hub', kind: 'system' }),
            message(7)
        ])
        expect(milestones.map((entry) => entry.seq)).toEqual([1, 2, 4, 5, 6])
    })
})
