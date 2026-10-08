import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { ThreadGoal } from '@/types/api'
import { useCodexGoal } from './useCodexGoal'

const goal: ThreadGoal = { threadId: 'native', objective: 'A desktop Goal', status: 'complete', tokenBudget: 500,
    tokensUsed: 200, timeUsedSeconds: 10, createdAt: 1, updatedAt: 2 }

function fixture() {
    const get = vi.fn(async () => ({ goal: goal as ThreadGoal | null }))
    const manage = vi.fn(async () => ({ goal: null as ThreadGoal | null }))
    const api = { getCodexGoal: get, manageCodexGoal: manage } as unknown as ApiClient
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    return { get, manage, api, wrapper }
}

describe('Codex Goal state', () => {
    it('reads the native Goal even without Goal history and refetches on a desktop clear', async () => {
        const f = fixture()
        const hook = renderHook(({ id }) => useCodexGoal(f.api, 'session', true, id), { wrapper: f.wrapper, initialProps: { id: 'complete' } })
        await waitFor(() => expect(hook.result.current.goal).toEqual(goal))
        const initialReads = f.get.mock.calls.length
        hook.rerender({ id: 'complete' })
        expect(f.get).toHaveBeenCalledTimes(initialReads)
        f.get.mockResolvedValue({ goal: null })
        hook.rerender({ id: 'cleared' })
        await waitFor(() => expect(hook.result.current.goal).toBeNull())
    })

    it('updates immediately after a confirmed action and preserves state on failure', async () => {
        const f = fixture()
        const hook = renderHook(() => useCodexGoal(f.api, 'session', true, null), { wrapper: f.wrapper })
        await waitFor(() => expect(hook.result.current.goal).toEqual(goal))
        f.manage.mockRejectedValueOnce(new Error('Native update failed'))
        await act(async () => { await expect(hook.result.current.act({ action: 'pause' })).rejects.toThrow('Native update failed') })
        expect(hook.result.current.goal).toEqual(goal)
        f.get.mockResolvedValue({ goal: null })
        await act(async () => { await hook.result.current.act({ action: 'clear' }) })
        await waitFor(() => expect(hook.result.current.goal).toBeNull())
        expect(f.manage).toHaveBeenLastCalledWith('session', { action: 'clear' })
    })

    it('reconciles a Goal that completes before the resume acknowledgement arrives', async () => {
        const f = fixture()
        const hook = renderHook(() => useCodexGoal(f.api, 'session', true, null), { wrapper: f.wrapper })
        await waitFor(() => expect(hook.result.current.goal).toEqual(goal))
        f.manage.mockResolvedValue({ goal: { ...goal, status: 'active' } })
        await act(async () => { await hook.result.current.act({ action: 'resume' }) })
        await waitFor(() => expect(hook.result.current.goal?.status).toBe('complete'))
    })

    it('does not read native state when controls are unavailable or access is read-only', () => {
        const f = fixture()
        const hook = renderHook(() => useCodexGoal(f.api, 'session', false, null), { wrapper: f.wrapper })
        expect(f.get).not.toHaveBeenCalled()
        expect(hook.result.current.goal).toBeUndefined()
    })
})
