import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useClaudeCustomModels(args: {
    api: ApiClient | null
    enabled?: boolean
}): {
    models: string[]
    isLoading: boolean
    error: string | null
} {
    const query = useQuery({
        queryKey: queryKeys.claudeCustomModels,
        queryFn: async () => {
            if (!args.api) throw new Error('API unavailable')
            return await args.api.getClaudeCustomModels()
        },
        enabled: Boolean(args.enabled && args.api),
        staleTime: 30_000,
        retry: false,
    })

    return {
        models: query.data?.models ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : null,
    }
}
