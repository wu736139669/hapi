import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_EXECUTION_PROCESS_ENABLED,
    getInitialExecutionProcessEnabled,
    useExecutionProcess,
} from './useExecutionProcess'

const STORAGE_KEY = 'hapi-execution-process-enabled'

describe('useExecutionProcess', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('defaults to enabled', () => {
        expect(getInitialExecutionProcessEnabled()).toBe(DEFAULT_EXECUTION_PROCESS_ENABLED)
    })

    it('reads a stored client preference', () => {
        window.localStorage.setItem(STORAGE_KEY, 'false')
        expect(getInitialExecutionProcessEnabled()).toBe(false)
    })

    it('persists disabling and removes the override when restored', () => {
        const { result } = renderHook(() => useExecutionProcess())

        act(() => result.current.setExecutionProcessEnabled(false))
        expect(result.current.executionProcessEnabled).toBe(false)
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false')

        act(() => result.current.setExecutionProcessEnabled(true))
        expect(result.current.executionProcessEnabled).toBe(true)
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('applies cross-tab changes', () => {
        const { result } = renderHook(() => useExecutionProcess())

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: 'false' }))
        })
        expect(result.current.executionProcessEnabled).toBe(false)

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: null }))
        })
        expect(result.current.executionProcessEnabled).toBe(true)
    })
})
