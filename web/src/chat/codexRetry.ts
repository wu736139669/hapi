import type { AgentEvent, NormalizedMessage } from '@/chat/types'

const CODEX_CAPACITY_ERROR = 'selected model is at capacity'

function isCapacityMessage(message: NormalizedMessage): boolean {
    if (message.role !== 'event') return false
    const event = message.content as AgentEvent
    return event.type === 'message'
        && typeof event.message === 'string'
        && event.message.toLowerCase().includes(CODEX_CAPACITY_ERROR)
}

/**
 * Returns the assistant-ui id of the one capacity error that can still be
 * retried. Older capacity notices are historical progress updates. Once a
 * later user/agent message arrives, the retry belongs to that newer turn and
 * the old error card must become informational only.
 *
 * `ready` is intentionally allowed after the candidate: Codex also emits a
 * ready event after a terminal failure, and that failure is exactly when the
 * manual retry affordance is needed.
 */
export function getRetryableCodexTurnMessageId(
    messages: readonly NormalizedMessage[],
    isThinking: boolean,
): string | null {
    if (isThinking) return null

    let candidateIndex = -1
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (isCapacityMessage(messages[index])) {
            candidateIndex = index
            break
        }
    }
    if (candidateIndex < 0) return null

    for (let index = candidateIndex + 1; index < messages.length; index += 1) {
        const message = messages[index]
        if (message.role === 'user' || message.role === 'agent') {
            return null
        }
        if (message.role === 'event' && message.content.type !== 'ready') {
            // A later non-capacity event means this failure was superseded by
            // another lifecycle transition (for example compaction or an
            // unrelated error). Keep the retry action on the current turn
            // only, never on stale history.
            if (!isCapacityMessage(message)) return null
        }
    }

    return `agent-event:${messages[candidateIndex].id}`
}
