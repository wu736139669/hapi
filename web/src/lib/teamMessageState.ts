import type { TeamMessage } from '@/types/team'

/**
 * Human-facing state of a team message that asks for a decision.
 * `null` means the message is not a decision (nothing for the human to do).
 */
export type HumanReplyState = 'pending' | 'replied' | 'dismissed'

function hasMetaValue(message: TeamMessage, key: string): boolean {
    const value = message.meta?.[key]
    return typeof value === 'number' || value === true
}

/**
 * True for member messages that explicitly ask the human for an answer.
 * `meta.toHuman` alone is only a notification (no reply needed) and stays out
 * of the inbox; `awaitingHuman` is kept for messages stored by older hubs.
 */
export function isHumanDecision(message: TeamMessage): boolean {
    if (message.fromKind !== 'session') return false
    return message.kind === 'decision'
        || message.meta?.awaitingHuman === true
}

/** Pending / replied / dismissed state for the "待你确认" inbox. */
export function humanReplyState(message: TeamMessage): HumanReplyState | null {
    if (!isHumanDecision(message)) return null
    if (hasMetaValue(message, 'humanRepliedAt')) return 'replied'
    if (hasMetaValue(message, 'humanDismissedAt')) return 'dismissed'
    return 'pending'
}

/** Decisions still waiting for a human answer, oldest first. */
export function pendingHumanDecisions(messages: TeamMessage[]): TeamMessage[] {
    return messages.filter((message) => humanReplyState(message) === 'pending')
}
