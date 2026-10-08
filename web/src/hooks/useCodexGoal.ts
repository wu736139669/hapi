import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CodexGoalRequest, CodexGoalResponse } from '@hapi/protocol/apiTypes'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useCodexGoal(api: ApiClient, sessionId: string, enabled: boolean, goalEventId: string | null) {
    const queryClient = useQueryClient()
    const queryKey = queryKeys.codexGoal(sessionId)
    const query = useQuery({
        queryKey,
        queryFn: () => api.getCodexGoal(sessionId),
        enabled,
        retry: false,
        refetchOnWindowFocus: true
    })
    // A Goal notification can arrive from the desktop, CLI, or this Web view.
    // Ordinary chat messages do not trigger extra native reads.
    useEffect(() => {
        if (enabled) void queryClient.invalidateQueries({ queryKey: queryKeys.codexGoal(sessionId) })
    }, [queryClient, sessionId, enabled, goalEventId])

    const act = async (action: CodexGoalRequest) => {
        await queryClient.cancelQueries({ queryKey })
        try {
            const result = await api.manageCodexGoal(sessionId, action)
            await queryClient.cancelQueries({ queryKey })
            queryClient.setQueryData<CodexGoalResponse>(queryKey, result)
            // Automatic continuation or a desktop action may already have
            // advanced the Goal beyond the mutation's response snapshot.
            void queryClient.invalidateQueries({ queryKey })
        } catch (error) {
            // A lost acknowledgement can follow a successful native mutation.
            void queryClient.invalidateQueries({ queryKey })
            throw error
        }
    }
    return { goal: enabled ? query.data?.goal : undefined, act }
}
