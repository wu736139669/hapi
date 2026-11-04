import { useQuery } from '@tanstack/react-query'
import type { TeamOverviewResponse } from '@hapi/protocol/apiTypes'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

const OVERVIEW_STALE_TIME_MS = 5_000

export function useTeamOverview(api: ApiClient | null, enabled = true): {
    overview: TeamOverviewResponse | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.teamOverview,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getTeamOverview()
        },
        enabled: Boolean(api) && enabled,
        staleTime: OVERVIEW_STALE_TIME_MS,
        // Status is derived from live session activity; a light poll keeps the
        // control room honest while it is open. Usage is cached hub-side.
        refetchInterval: 15_000,
        retry: false,
    })

    return {
        overview: query.data ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load control room' : null,
        refetch: query.refetch,
    }
}
