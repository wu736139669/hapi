import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SessionShareListItem } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useSessionShares(api: ApiClient | null, enabled = true): {
    shares: SessionShareListItem[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.sessionShares,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getSessionShares()
        },
        enabled: Boolean(api) && enabled,
    })

    return {
        shares: query.data?.shares ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load shared sessions' : null,
        refetch: async () => { await query.refetch() },
    }
}
