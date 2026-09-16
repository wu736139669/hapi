import type { TeamMessage, TeamRequirement } from '@/types/team'

export interface RequirementGroup {
    /** null = messages that were not filed under any requirement ("其他"). */
    requirement: TeamRequirement | null
    messages: TeamMessage[]
}

function requirementIdOf(message: TeamMessage): string | null {
    const value = message.meta?.requirementId
    return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Group a team timeline by requirement (a human ask), oldest first. Messages
 * without a known requirement id land in a trailing `null` group so nothing is
 * ever hidden by the grouping.
 */
export function groupMessagesByRequirement(
    requirements: TeamRequirement[],
    messages: TeamMessage[]
): RequirementGroup[] {
    const knownIds = new Set(requirements.map((requirement) => requirement.id))
    const byId = new Map<string, TeamMessage[]>()
    const unassigned: TeamMessage[] = []
    for (const message of messages) {
        const id = requirementIdOf(message)
        if (id && knownIds.has(id)) {
            const list = byId.get(id)
            if (list) {
                list.push(message)
            } else {
                byId.set(id, [message])
            }
        } else {
            unassigned.push(message)
        }
    }
    const groups: RequirementGroup[] = []
    for (const requirement of [...requirements].sort((a, b) => a.createdAt - b.createdAt)) {
        const list = byId.get(requirement.id)
        if (list && list.length > 0) {
            groups.push({ requirement, messages: list })
        }
    }
    if (unassigned.length > 0) {
        groups.push({ requirement: null, messages: unassigned })
    }
    return groups
}
