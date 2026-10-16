import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { initializeTheme, useAppearance } from './useTheme'
import { initializeThemeColors, useThemeColors } from './useThemeColors'
import { useColorTheme } from './useColorTheme'
import { initializeChatSurfaceColors } from './useChatSurfaceColors'
import { useAppearanceSkin } from './useAppearanceSkin'
import { setAppearanceSkin } from '@/lib/appearanceSkin'

beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    setAppearanceSkin('default')
    localStorage.setItem('hapi-appearance', 'light')
    initializeTheme()
    initializeThemeColors()
    initializeChatSurfaceColors()
})

it('keeps explicit palette and custom colors above skin defaults and restores them on reset', () => {
    const skin = renderHook(useAppearanceSkin)
    const preset = renderHook(useColorTheme)
    const colors = renderHook(useThemeColors)
    act(() => skin.result.current.setSkin('forest-adventure'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#f7f3e8')
    act(() => preset.result.current.setColorTheme('nord'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#eceff4')
    act(() => colors.result.current.setColor('background', '#dfe9dc'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#dfe9dc')
    act(() => skin.result.current.setSkin('default'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#dfe9dc')
    expect(localStorage.getItem('hapi-color-theme')).toBe('nord')
    expect(localStorage.getItem('hapi-theme-colors')).toContain('#dfe9dc')
})

it('follows light, dark and OLED and removes all skin palette values when reset', () => {
    const appearance = renderHook(useAppearance)
    act(() => setAppearanceSkin('forest-adventure'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#f7f3e8')
    act(() => appearance.result.current.setAppearance('dark'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#15221c')
    act(() => appearance.result.current.setAppearance('oled'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#000000')
    act(() => setAppearanceSkin('default'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--app-button')).toBe('')
    expect(document.documentElement).toHaveAttribute('data-theme', 'oled')
})
