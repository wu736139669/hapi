import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { initializeTheme, useAppearance } from './useTheme'
import { initializeThemeColors, useThemeColors } from './useThemeColors'
import { useColorTheme } from './useColorTheme'
import { initializeChatSurfaceColors } from './useChatSurfaceColors'
import { useAppearanceSkin } from './useAppearanceSkin'
import { setAppearanceSkin } from '@/lib/appearanceSkin'

const SKIN_CASES = [
    { skin: 'forest-adventure', light: '#f7f3e8', dark: '#15221c' },
    { skin: 'macaron-gradient', light: '#fcf7fb', dark: '#1c1724' },
    { skin: 'macaron-peach', light: '#fff8f2', dark: '#241b18' },
    { skin: 'macaron-mint', light: '#f4fbf8', dark: '#15221f' },
    { skin: 'macaron-blueberry', light: '#f7f8ff', dark: '#191e2c' },
    { skin: 'macaron-lemon', light: '#fffcef', dark: '#242117' },
    { skin: 'macaron-rose', light: '#fff7fb', dark: '#251923' },
] as const

beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    setAppearanceSkin('default')
    localStorage.setItem('hapi-appearance', 'light')
    initializeTheme()
    initializeThemeColors()
    initializeChatSurfaceColors()
})

it.each(SKIN_CASES)('keeps explicit palette and custom colors above $skin defaults and restores them on reset', ({ skin: skinId, light }) => {
    const skin = renderHook(useAppearanceSkin)
    const preset = renderHook(useColorTheme)
    const colors = renderHook(useThemeColors)
    act(() => skin.result.current.setSkin(skinId))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe(light)
    act(() => preset.result.current.setColorTheme('nord'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#eceff4')
    act(() => colors.result.current.setColor('background', '#dfe9dc'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#dfe9dc')
    act(() => skin.result.current.setSkin('default'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#dfe9dc')
    expect(localStorage.getItem('hapi-color-theme')).toBe('nord')
    expect(localStorage.getItem('hapi-theme-colors')).toContain('#dfe9dc')
})

it.each(SKIN_CASES)('$skin follows light, dark and OLED and removes skin palette values when reset', ({ skin, light, dark }) => {
    const appearance = renderHook(useAppearance)
    act(() => setAppearanceSkin(skin))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe(light)
    act(() => appearance.result.current.setAppearance('dark'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe(dark)
    act(() => appearance.result.current.setAppearance('oled'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('#000000')
    act(() => setAppearanceSkin('default'))
    expect(document.documentElement.style.getPropertyValue('--app-bg')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--app-button')).toBe('')
    expect(document.documentElement).toHaveAttribute('data-theme', 'oled')
})

it('keeps explicit surface and border choices when the shared Macaron material changes hue', () => {
    const colors = renderHook(useThemeColors)
    act(() => setAppearanceSkin('macaron-mint'))
    act(() => colors.result.current.setColor('surface', '#e9efed'))
    act(() => colors.result.current.setColor('border', '#a3b3ad'))
    act(() => setAppearanceSkin('macaron-blueberry'))
    expect(document.documentElement.style.getPropertyValue('--app-tool-card-bg')).toBe('#e9efed')
    expect(document.documentElement.style.getPropertyValue('--app-border')).toBe('#a3b3ad')
    act(() => setAppearanceSkin('default'))
    expect(document.documentElement.style.getPropertyValue('--app-tool-card-bg')).toBe('#e9efed')
    expect(document.documentElement.style.getPropertyValue('--app-border')).toBe('#a3b3ad')
})
