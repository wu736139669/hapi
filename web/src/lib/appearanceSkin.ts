export const APPEARANCE_SKINS = [
    'default', 'forest-adventure', 'macaron-gradient',
    'macaron-peach', 'macaron-mint', 'macaron-blueberry', 'macaron-lemon', 'macaron-rose',
] as const
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

export const MACARON_SKIN_COLORS = {
    'macaron-gradient': MACARON_BASE_COLORS,
    'macaron-peach': {
        light: { accent: '#9c543f', background: '#fff8f2', foreground: '#4a362f', hint: '#735b50', secondary: '#f9eadd' },
        dark: { accent: '#edbc9e', background: '#241b18', foreground: '#f5e8df', hint: '#c7b2a5', secondary: '#382b25' },
        oled: { accent: '#edbc9e', background: '#000000', foreground: '#f5e8df', hint: '#c7b2a5', secondary: '#281f1b' },
    },
    'macaron-mint': {
        light: { accent: '#2e7164', background: '#f4fbf8', foreground: '#2e4841', hint: '#4c6a61', secondary: '#e4f1eb' },
        dark: { accent: '#a0dacc', background: '#15221f', foreground: '#e4f3ed', hint: '#abc7bc', secondary: '#223832' },
        oled: { accent: '#a0dacc', background: '#000000', foreground: '#e4f3ed', hint: '#abc7bc', secondary: '#172923' },
    },
    'macaron-blueberry': {
        light: { accent: '#5368a5', background: '#f7f8ff', foreground: '#344060', hint: '#4e5d77', secondary: '#e7ecfa' },
        dark: { accent: '#b5c6f7', background: '#191e2c', foreground: '#e8edf9', hint: '#b1bed5', secondary: '#293247' },
        oled: { accent: '#b5c6f7', background: '#000000', foreground: '#e8edf9', hint: '#b1bed5', secondary: '#1b2334' },
    },
    'macaron-lemon': {
        light: { accent: '#806526', background: '#fffcef', foreground: '#4a432c', hint: '#6d6445', secondary: '#f4efd7' },
        dark: { accent: '#e4d392', background: '#242117', foreground: '#f4eed9', hint: '#c6bc97', secondary: '#363225' },
        oled: { accent: '#e4d392', background: '#000000', foreground: '#f4eed9', hint: '#c6bc97', secondary: '#272318' },
    },
    'macaron-rose': {
        light: { accent: '#9a5074', background: '#fff7fb', foreground: '#503345', hint: '#715565', secondary: '#f7e5ee' },
        dark: { accent: '#eab6d0', background: '#251923', foreground: '#f8e6f0', hint: '#cbb0bf', secondary: '#3b2836' },
        oled: { accent: '#eab6d0', background: '#000000', foreground: '#f8e6f0', hint: '#cbb0bf', secondary: '#2a1b25' },
    },
} as const
