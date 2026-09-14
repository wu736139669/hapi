import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TeamMemoryFile } from '@/types/team'
import { queryKeys } from '@/lib/query-keys'

export function useTeamMemory(api: ApiClient | null, teamId: string | null): {
    files: TeamMemoryFile[]
    isLoading: boolean
} {
    const query = useQuery({
        queryKey: queryKeys.teamMemory(teamId ?? ''),
        queryFn: async () => {
            if (!api || !teamId) {
                throw new Error('API unavailable')
            }
            return await api.getTeamMemory(teamId)
        },
        enabled: Boolean(api && teamId),
        staleTime: 10_000,
        refetchInterval: 30_000,
        retry: false,
    })

    return {
        files: query.data?.files ?? [],
        isLoading: query.isLoading,
    }
}
