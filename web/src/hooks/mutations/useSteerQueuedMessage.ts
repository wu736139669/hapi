import { useMutation } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import {
    appendOptimisticMessage,
    getMessageWindowState,
    markMessagesConsumed,
    markMessagesDispatching,
    markMessagesIndeterminate,
    markMessagesRequeued,
    reconcileQueuedLocalIds
} from '@/lib/message-window-store'
import { usePlatform } from '@/hooks/usePlatform'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

type SteerQueuedMessageInput = {
    sessionId: string
    messageId: string
    /** Optional UI correlation for the pending row; the RPC only needs ids. */
    localId?: string
}

/**
 * Mutation: steer one waiting-queue message into the active turn.
 * Success is confirmed by messages-consumed (steered:true) SSE; this call only
 * asks the CLI to start the steer.
 */
export function useSteerQueuedMessage(api: ApiClient | null) {
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const { t } = useTranslation()

    return useMutation({
        mutationFn: async (input: SteerQueuedMessageInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const steer = api.steerMessage ?? api.steerQueuedMessage
            return steer.call(api, input.sessionId, input.messageId)
        },
        onSuccess: async (result, input) => {
            if (result.status === 'failed') {
                addToast({
                    title: t('queuedMessages.steerFailed'),
                    body: result.error,
                    sessionId: input.sessionId,
                    url: window.location.href,
                })
                haptic.notification('error')
                return
            }
            if (result.status === 'invoked') {
                // Race: CLI already consumed the row. Merge the authoritative
                // invoked message so the queued bar clears even if SSE was missed
                // (same pattern as useCancelQueuedMessage).
                appendOptimisticMessage(input.sessionId, {
                    id: result.message.id,
                    seq: result.message.seq,
                    localId: result.message.localId,
                    content: result.message.content,
                    createdAt: result.message.createdAt,
                    invokedAt: result.message.invokedAt,
                    scheduledAt: result.message.scheduledAt,
                    status: 'sent',
                })
                addToast({
                    title: t('queuedMessages.steerAlreadyInvoked'),
                    body: '',
                    sessionId: input.sessionId,
                    url: window.location.href,
                })
            }
            if (result.status === 'steered' && result.localId && api) {
                const localId = result.localId
                const current = () => getMessageWindowState(input.sessionId).messages.find(message => message.localId === localId)
                const before = current()
                // A successful RPC can beat the pending SSE. Hold the row without
                // claiming invocation, but never replace an already observed outcome.
                if (!before || before.invokedAt !== null || before.deliveryState === 'indeterminate') return
                markMessagesDispatching(input.sessionId, [localId])
                const pending = current()
                try {
                    const state = await api.getQueuedState(input.sessionId, [localId])
                    const invoked = state.invokedLocalMessages.find(message => message.localId === localId)
                    if (invoked) {
                        markMessagesConsumed(input.sessionId, [localId], invoked.invokedAt)
                    } else if (current() === pending) {
                        if (state.dispatchingLocalIds?.includes(localId)) {
                            markMessagesDispatching(input.sessionId, [localId])
                        } else if (state.indeterminateLocalIds?.includes(localId)) {
                            markMessagesIndeterminate(input.sessionId, [localId])
                        } else if (state.queuedLocalIds.includes(localId)) {
                            markMessagesRequeued(input.sessionId, [localId])
                        } else {
                            reconcileQueuedLocalIds(input.sessionId, [localId], [])
                        }
                    }
                } catch {
                    // An unavailable readback is not evidence of rejection or
                    // delivery. Preserve the hold until SSE/reconnect reconciles it.
                }
            }
            haptic.notification('success')
        },
        onError: (error, input) => {
            addToast({
                title: t('queuedMessages.steerFailed'),
                body: error instanceof Error ? error.message : String(error),
                sessionId: input.sessionId,
                url: window.location.href,
            })
            haptic.notification('error')
        },
    })
}
