import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { useClaudeCustomModels } from './useClaudeCustomModels'

function wrapper(queryClient: QueryClient) {
    return ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
}

function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false }
        }
    })
}

describe('useClaudeCustomModels', () => {
    it('shares the configured Claude model catalog across existing sessions', async () => {
        const getClaudeCustomModels = vi.fn(async () => ({
            models: ['deepseek-v4-flash[1m]', 'deepseek-v4-pro[1m]']
        }))
        const api = { getClaudeCustomModels } as unknown as ApiClient
        const queryClient = createQueryClient()
        const sharedWrapper = wrapper(queryClient)

        const first = renderHook(() => useClaudeCustomModels({ api, enabled: true }), {
            wrapper: sharedWrapper
        })
        const second = renderHook(() => useClaudeCustomModels({ api, enabled: true }), {
            wrapper: sharedWrapper
        })

        await waitFor(() => {
            expect(first.result.current.models).toEqual([
                'deepseek-v4-flash[1m]',
                'deepseek-v4-pro[1m]'
            ])
            expect(second.result.current.models).toEqual(first.result.current.models)
        })
        expect(getClaudeCustomModels).toHaveBeenCalledTimes(1)
    })

    it('returns an empty optional catalog when the request fails', async () => {
        const api = {
            getClaudeCustomModels: vi.fn(async () => {
                throw new Error('older hub')
            })
        } as unknown as ApiClient

        const result = renderHook(() => useClaudeCustomModels({ api, enabled: true }), {
            wrapper: wrapper(createQueryClient())
        })

        await waitFor(() => {
            expect(result.result.current.error).toBe('older hub')
        })
        expect(result.result.current.models).toEqual([])
    })
})
