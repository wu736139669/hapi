export const APPEARANCE_SKINS = ['default', 'forest-adventure', 'macaron-gradient'] as const
export type AppearanceSkin = typeof APPEARANCE_SKINS[number]

export const APPEARANCE_SKIN_KEY = 'hapi-appearance-skin'
export const APPEARANCE_SKIN_EVENT = 'hapi-appearance-skin-change'

export function parseAppearanceSkin(value: string | null): AppearanceSkin {
    return APPEARANCE_SKINS.find(skin => skin === value) ?? 'default'
}

export function getStoredAppearanceSkin(): AppearanceSkin {
    try {
        return parseAppearanceSkin(localStorage.getItem(APPEARANCE_SKIN_KEY))
    } catch {
        return 'default'
    }
}

export function getAppearanceSkin(): AppearanceSkin {
    if (typeof document === 'undefined') return getStoredAppearanceSkin()
    const value = document.documentElement.getAttribute('data-skin')
    return value === null ? getStoredAppearanceSkin() : parseAppearanceSkin(value)
}

function applyAppearanceSkin(skin: AppearanceSkin): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (root.getAttribute('data-skin') === skin) return
    root.setAttribute('data-skin', skin)
    window.dispatchEvent(new Event(APPEARANCE_SKIN_EVENT))
}

export function setAppearanceSkin(skin: AppearanceSkin): void {
    try {
        if (skin === 'default') localStorage.removeItem(APPEARANCE_SKIN_KEY)
        else localStorage.setItem(APPEARANCE_SKIN_KEY, skin)
    } catch {
        // The current page can still use the skin when storage is unavailable.
    }
    applyAppearanceSkin(skin)
}

let initialized = false

export function initializeAppearanceSkin(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    if (!document.documentElement.hasAttribute('data-skin')) {
        applyAppearanceSkin(getStoredAppearanceSkin())
    }
    if (initialized) return
    initialized = true
    const updateMotion = () => {
        document.documentElement.setAttribute('data-skin-motion', document.hidden ? 'paused' : 'active')
    }
    updateMotion()
    document.addEventListener('visibilitychange', updateMotion)
    window.addEventListener('storage', (event: StorageEvent) => {
        if (event.key === APPEARANCE_SKIN_KEY) applyAppearanceSkin(parseAppearanceSkin(event.newValue))
        else if (event.key === null) applyAppearanceSkin(getStoredAppearanceSkin())
    })
}

// Keep the base colors small and shared with the existing palette resolver.
// The same three backgrounds are used by index.html before React starts.
export const FOREST_BASE_COLORS = {
    light: { accent: '#3c7451', background: '#f7f3e8', foreground: '#2b3e30', hint: '#65715d', secondary: '#eeead9' },
    dark: { accent: '#b3d58b', background: '#15221c', foreground: '#eeeada', hint: '#a7b49b', secondary: '#23372b' },
    oled: { accent: '#b3d58b', background: '#000000', foreground: '#eeeada', hint: '#a7b49b', secondary: '#13241a' },
} as const

export const MACARON_BASE_COLORS = {
    light: { accent: '#79569c', background: '#fcf7fb', foreground: '#3e344b', hint: '#685772', secondary: '#f1eaf6' },
    dark: { accent: '#d4b7ed', background: '#1c1724', foreground: '#f2eaf7', hint: '#bdb0c9', secondary: '#302638' },
    oled: { accent: '#d4b7ed', background: '#000000', foreground: '#f2eaf7', hint: '#bdb0c9', secondary: '#211927' },
} as const
