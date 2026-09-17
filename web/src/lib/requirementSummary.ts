import type { TeamMessage, TeamRequirement, TeamTask } from '@/types/team'

export interface RequirementOutcome {
    /** 'conclusion' = the lead wrote one; 'tasks' = derived from task states. */
    kind: 'conclusion' | 'tasks' | 'none'
    doneTasks: number
    totalTasks: number
    /** Latest task evidence (branch/files/test result), when a task carries one. */
    deliverable: string | null
    /** One-line preview of the newest message, for in-progress requirements. */
    latestText: string | null
}

function readDeliverable(task: TeamTask): string | null {
    const value = task.meta?.deliverable
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * What the human should read at a glance: the lead's conclusion when it exists,
 * otherwise a result derived from the requirement's tasks.
 */
export function requirementOutcome(
    requirement: TeamRequirement | null,
    tasks: TeamTask[],
    messages: TeamMessage[]
): RequirementOutcome {
    const doneTasks = tasks.filter((task) => task.status === 'done').length
    const totalTasks = tasks.length
    const deliverable = [...tasks]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(readDeliverable)
        .find((value): value is string => value !== null) ?? null
    const last = messages[messages.length - 1]
    const latestText = last ? last.text.replace(/\s+/g, ' ').slice(0, 80) : null
    if (requirement?.conclusion) {
        return { kind: 'conclusion', doneTasks, totalTasks, deliverable, latestText }
    }
    if (totalTasks > 0) {
        return { kind: 'tasks', doneTasks, totalTasks, deliverable, latestText }
    }
    return { kind: 'none', doneTasks, totalTasks, deliverable, latestText }
}

/**
 * Key nodes of a requirement's process: what the human wrote, decisions, task
 * hand-offs, completed/blocked tasks and system notices. Everything else is
 * ordinary chatter that stays behind "show full process".
 */
export function selectMilestones(messages: TeamMessage[]): TeamMessage[] {
    return messages.filter((message) => {
        if (message.fromKind === 'human' || message.fromKind === 'hub') return true
        if (message.kind === 'decision' || message.kind === 'system') return true
        if (message.kind === 'task-update') {
            const status = message.meta?.status
            if (status === 'done' || status === 'blocked') return true
            // Older hubs did not record the status in meta; fall back to text.
            return /(→|->)\s*(done|blocked)/.test(message.text)
        }
        if (typeof message.meta?.deliverable === 'string') return true
        return false
    })
}
