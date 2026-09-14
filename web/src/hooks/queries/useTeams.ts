import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TeamSummary } from '@/types/team'
import { queryKeys } from '@/lib/query-keys'

export function useTeams(api: ApiClient | null): {
    teams: TeamSummary[]
    isLoading: boolean
    /** True when the hub has the teams feature enabled (query succeeded). */
    supported: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.teams,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getTeams()
        },
        enabled: Boolean(api),
        staleTime: 30_000,
        retry: false,
    })

    return {
        teams: query.data?.teams ?? [],
        isLoading: query.isLoading,
        supported: query.isSuccess,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load teams' : null,
        refetch: query.refetch,
    }
}
