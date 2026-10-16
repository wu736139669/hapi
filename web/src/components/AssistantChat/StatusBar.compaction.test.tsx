import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { StatusBar } from './StatusBar'

const NOW = 1_792_068_848_000

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    localStorage.setItem('hapi-lang', 'zh-CN')
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
})

describe('compaction status', () => {
    const props = { active: true, thinking: true, agentState: { contextCompactionStartedAt: NOW - 188_000 } }
    const view = (overrides: Partial<Parameters<typeof StatusBar>[0]> = {}) => (
        <I18nProvider><StatusBar {...props} {...overrides} /></I18nProvider>
    )

    it('shows the elapsed compaction time, ticks, and removes the timer on completion', () => {
        const result = render(view())
        expect(screen.getByText('正在压缩上下文').textContent).toBe('正在压缩上下文 · 3:08')
        act(() => vi.advanceTimersByTime(2_000))
        expect(screen.getByText('正在压缩上下文').textContent).toBe('正在压缩上下文 · 3:10')
        result.rerender(view({ agentState: { contextCompactionStartedAt: null } }))
        expect(screen.queryByText('正在压缩上下文')).toBeNull()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('keeps elapsed time when reopened and supports English', () => {
        localStorage.setItem('hapi-lang', 'en')
        const result = render(view())
        expect(screen.getByText('Compacting context').textContent).toContain('3:08')
        result.unmount()
        act(() => vi.advanceTimersByTime(2_000))
        render(view())
        expect(screen.getByText('Compacting context').textContent).toContain('3:10')
    })

    it('gives offline and permission states priority over a retained compaction timestamp', () => {
        const interval = vi.spyOn(window, 'setInterval')
        const result = render(view({ active: false }))
        expect(screen.getByText('offline')).toBeTruthy()
        expect(screen.queryByText('正在压缩上下文')).toBeNull()
        expect(interval).not.toHaveBeenCalled()
        result.rerender(view({ agentState: {
            ...props.agentState,
            requests: { permission: { tool: 'Bash', arguments: {}, createdAt: NOW } }
        } }))
        expect(screen.getByText('需要权限')).toBeTruthy()
        expect(screen.queryByText('正在压缩上下文')).toBeNull()
        expect(interval).not.toHaveBeenCalled()
    })
})
