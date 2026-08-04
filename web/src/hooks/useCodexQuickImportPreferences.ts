import { useCallback, useEffect, useState } from 'react'

export const DEFAULT_CODEX_QUICK_IMPORT_HOURS = 5
export const MIN_CODEX_QUICK_IMPORT_HOURS = 1
export const MAX_CODEX_QUICK_IMPORT_HOURS = 24
export const DEFAULT_SHOW_CODEX_QUICK_IMPORT_LOAD_MORE = true

export const CODEX_QUICK_IMPORT_PREFERENCES_STORAGE_KEY = 'hapi-codex-quick-import-preferences'

export type CodexQuickImportPreferences = {
    initialHours: number
    showLoadMore: boolean
}

const DEFAULT_PREFERENCES: CodexQuickImportPreferences = {
    initialHours: DEFAULT_CODEX_QUICK_IMPORT_HOURS,
    showLoadMore: DEFAULT_SHOW_CODEX_QUICK_IMPORT_LOAD_MORE
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export function normalizeCodexQuickImportHours(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_CODEX_QUICK_IMPORT_HOURS
    return Math.min(MAX_CODEX_QUICK_IMPORT_HOURS, Math.max(MIN_CODEX_QUICK_IMPORT_HOURS, Math.round(value)))
}

function parsePreferences(raw: string | null): CodexQuickImportPreferences {
    if (!raw) return DEFAULT_PREFERENCES
    try {
        const value = JSON.parse(raw) as { initialHours?: unknown; showLoadMore?: unknown }
        return {
            initialHours: normalizeCodexQuickImportHours(
                typeof value.initialHours === 'number' ? value.initialHours : DEFAULT_CODEX_QUICK_IMPORT_HOURS
            ),
            showLoadMore: typeof value.showLoadMore === 'boolean'
                ? value.showLoadMore
                : DEFAULT_SHOW_CODEX_QUICK_IMPORT_LOAD_MORE
        }
    } catch {
        return DEFAULT_PREFERENCES
    }
}

export function getInitialCodexQuickImportPreferences(): CodexQuickImportPreferences {
    if (!isBrowser()) return DEFAULT_PREFERENCES
    try {
        return parsePreferences(localStorage.getItem(CODEX_QUICK_IMPORT_PREFERENCES_STORAGE_KEY))
    } catch {
        return DEFAULT_PREFERENCES
    }
}

function storePreferences(preferences: CodexQuickImportPreferences): void {
    if (!isBrowser()) return
    try {
        if (
            preferences.initialHours === DEFAULT_CODEX_QUICK_IMPORT_HOURS
            && preferences.showLoadMore === DEFAULT_SHOW_CODEX_QUICK_IMPORT_LOAD_MORE
        ) {
            localStorage.removeItem(CODEX_QUICK_IMPORT_PREFERENCES_STORAGE_KEY)
        } else {
            localStorage.setItem(CODEX_QUICK_IMPORT_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
        }
    } catch {
        // Keep the in-memory preference when storage is unavailable.
    }
}

export function useCodexQuickImportPreferences(): {
    preferences: CodexQuickImportPreferences
    setInitialHours: (hours: number) => void
    setShowLoadMore: (show: boolean) => void
} {
    const [preferences, setPreferences] = useState(getInitialCodexQuickImportPreferences)

    useEffect(() => {
        if (!isBrowser()) return
        const onStorage = (event: StorageEvent) => {
            if (event.key === CODEX_QUICK_IMPORT_PREFERENCES_STORAGE_KEY) setPreferences(parsePreferences(event.newValue))
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const updatePreferences = useCallback((update: (current: CodexQuickImportPreferences) => CodexQuickImportPreferences) => {
        setPreferences((current) => {
            const next = update(current)
            storePreferences(next)
            return next
        })
    }, [])

    const setInitialHours = useCallback((hours: number) => {
        updatePreferences((current) => ({ ...current, initialHours: normalizeCodexQuickImportHours(hours) }))
    }, [updatePreferences])

    const setShowLoadMore = useCallback((showLoadMore: boolean) => {
        updatePreferences((current) => ({ ...current, showLoadMore }))
    }, [updatePreferences])

    return { preferences, setInitialHours, setShowLoadMore }
}
