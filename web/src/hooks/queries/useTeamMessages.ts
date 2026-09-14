import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TeamMessage } from '@/types/team'
import { queryKeys } from '@/lib/query-keys'

const TEAM_MESSAGES_STALE_TIME_MS = 3_000

export function useTeamMessages(api: ApiClient | null, teamId: string | null): {
    messages: TeamMessage[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.teamMessages(teamId ?? ''),
        queryFn: async () => {
            if (!api || !teamId) {
                throw new Error('API unavailable')
            }
            return await api.getTeamMessages(teamId, { limit: 2000 })
        },
        enabled: Boolean(api && teamId),
        staleTime: TEAM_MESSAGES_STALE_TIME_MS,
        // SSE team-updated drives freshness; this is a cheap safety net for a
        // dropped event.
        refetchInterval: 15_000,
        retry: false,
    })

    return {
        messages: query.data?.messages ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load team messages' : null,
        refetch: query.refetch,
    }
}
