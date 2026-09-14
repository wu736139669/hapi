import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TeamDetail } from '@/types/team'
import { queryKeys } from '@/lib/query-keys'

const TEAM_DETAIL_STALE_TIME_MS = 3_000

export function useTeam(api: ApiClient | null, teamId: string | null): {
    detail: TeamDetail | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.team(teamId ?? ''),
        queryFn: async () => {
            if (!api || !teamId) {
                throw new Error('API unavailable')
            }
            return await api.getTeam(teamId)
        },
        enabled: Boolean(api && teamId),
        staleTime: TEAM_DETAIL_STALE_TIME_MS,
        // Member status is derived hub-side from live session activity, so a
        // light poll keeps the roster honest while the page is open.
        refetchInterval: 5_000,
        retry: false,
    })

    return {
        detail: query.data ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load team' : null,
        refetch: query.refetch,
    }
}
