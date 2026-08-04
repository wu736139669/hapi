import { useMutation } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { appendOptimisticMessage } from '@/lib/message-window-store'
import { usePlatform } from '@/hooks/usePlatform'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

type SteerQueuedMessageInput = {
    sessionId: string
    messageId: string
}

export function useSteerQueuedMessage(api: ApiClient | null) {
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const { t } = useTranslation()

    return useMutation({
        mutationFn: async (input: SteerQueuedMessageInput) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return api.steerQueuedMessage(input.sessionId, input.messageId)
        },
        onSuccess: (result, input) => {
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
                appendOptimisticMessage(input.sessionId, {
                    ...result.message,
                    status: 'sent',
                })
                addToast({
                    title: t('queuedMessages.steerAlreadyInvoked'),
                    body: '',
                    sessionId: input.sessionId,
                    url: window.location.href,
                })
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
