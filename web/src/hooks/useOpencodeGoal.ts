import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { OpencodeGoalRequest, OpencodeGoalResponse } from '@hapi/protocol/apiTypes'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

/** Codex parity: the goal comes from a live RPC query, never from chat text. */
export function useOpencodeGoal(api: ApiClient, sessionId: string, enabled: boolean, goalEventId: string | null) {
    const queryClient = useQueryClient()
    const queryKey = queryKeys.opencodeGoal(sessionId)
    const query = useQuery({
        queryKey,
        queryFn: () => api.getOpencodeGoal(sessionId),
        enabled,
        retry: false,
        refetchOnWindowFocus: true
    })

    useEffect(() => {
        if (enabled) void queryClient.invalidateQueries({ queryKey })
    }, [queryClient, sessionId, enabled, goalEventId])

    const act = async (action: OpencodeGoalRequest) => {
        await queryClient.cancelQueries({ queryKey })
        try {
            const result = await api.manageOpencodeGoal(sessionId, action)
            queryClient.setQueryData<OpencodeGoalResponse>(queryKey, result)
            void queryClient.invalidateQueries({ queryKey })
        } catch (error) {
            void queryClient.invalidateQueries({ queryKey })
            throw error
        }
    }
    return { goal: enabled ? query.data?.goal : undefined, act }
}
