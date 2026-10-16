import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppearanceSkin } from './useAppearanceSkin'
import { APPEARANCE_SKIN_KEY, getStoredAppearanceSkin, initializeAppearanceSkin, parseAppearanceSkin } from '@/lib/appearanceSkin'

beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-skin')
    initializeAppearanceSkin()
})

describe('appearance skin preference', () => {
    it('defaults safely for absent or corrupt values', () => {
        expect(parseAppearanceSkin(null)).toBe('default')
        expect(parseAppearanceSkin('{broken')).toBe('default')
        localStorage.setItem(APPEARANCE_SKIN_KEY, 'unknown')
        expect(getStoredAppearanceSkin()).toBe('default')
    })

    it('updates all same-page consumers and restores default without touching other preferences', () => {
        localStorage.setItem('hapi-color-theme', 'nord')
        const first = renderHook(useAppearanceSkin)
        const second = renderHook(useAppearanceSkin)
        act(() => first.result.current.setSkin('forest-adventure'))
        expect(second.result.current.skin).toBe('forest-adventure')
        expect(document.documentElement).toHaveAttribute('data-skin', 'forest-adventure')
        expect(getStoredAppearanceSkin()).toBe('forest-adventure')
        act(() => second.result.current.setSkin('default'))
        expect(first.result.current.skin).toBe('default')
        expect(localStorage.getItem(APPEARANCE_SKIN_KEY)).toBeNull()
        expect(localStorage.getItem('hapi-color-theme')).toBe('nord')
    })

    it('responds to another tab selecting a skin and clearing storage', () => {
        const { result } = renderHook(useAppearanceSkin)
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_SKIN_KEY, newValue: 'forest-adventure' })))
        expect(result.current.skin).toBe('forest-adventure')
        act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })))
        expect(result.current.skin).toBe('default')
    })

    it('keeps the current page usable when persistence is denied', () => {
        const { result } = renderHook(useAppearanceSkin)
        const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
        act(() => result.current.setSkin('forest-adventure'))
        expect(result.current.skin).toBe('forest-adventure')
        denied.mockRestore()
        const unreadable = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        expect(getStoredAppearanceSkin()).toBe('default')
        unreadable.mockRestore()
    })
})
