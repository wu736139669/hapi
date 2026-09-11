import { useCallback, useEffect, useState } from 'react'

export type SessionListToolbarPreferenceKey =
    | 'showSearch'
    | 'showDateFilter'
    | 'showUnreadFilter'
    | 'showShareManager'
    | 'showBrowse'
    | 'collapsed'

export type SessionListToolbarPreferences = Record<SessionListToolbarPreferenceKey, boolean>

export const DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES: SessionListToolbarPreferences = {
    showSearch: true,
    showDateFilter: true,
    showUnreadFilter: true,
    showShareManager: true,
    showBrowse: true,
    collapsed: false,
}

const STORAGE_KEY = 'hapi-session-list-toolbar'
const CHANGE_EVENT = 'hapi-session-list-toolbar-change'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export function parseSessionListToolbarPreferences(raw: string | null): SessionListToolbarPreferences {
    if (!raw) return DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES
    try {
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES
        }
        const record = parsed as Record<string, unknown>
        return Object.fromEntries(
            Object.entries(DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES).map(([key, fallback]) => [
                key,
                typeof record[key] === 'boolean' ? record[key] : fallback,
            ])
        ) as SessionListToolbarPreferences
    } catch {
        return DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES
    }
}

function readPreferences(): SessionListToolbarPreferences {
    if (!isBrowser()) return DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES
    try {
        return parseSessionListToolbarPreferences(window.localStorage.getItem(STORAGE_KEY))
    } catch {
        return DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES
    }
}

function writePreferences(preferences: SessionListToolbarPreferences): void {
    if (!isBrowser()) return
    try {
        const isDefault = Object.entries(DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES).every(([key, value]) => (
            preferences[key as SessionListToolbarPreferenceKey] === value
        ))
        if (isDefault) window.localStorage.removeItem(STORAGE_KEY)
        else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
        // The browser's storage event does not fire in the tab that made the
        // change. Notify mounted session-list surfaces in this tab as well.
        window.dispatchEvent(new Event(CHANGE_EVENT))
    } catch {
        // Ignore storage errors.
    }
}

export function useSessionListToolbar(): {
    preferences: SessionListToolbarPreferences
    setPreference: (key: SessionListToolbarPreferenceKey, value: boolean) => void
} {
    const [preferences, setPreferences] = useState<SessionListToolbarPreferences>(readPreferences)

    useEffect(() => {
        if (!isBrowser()) return
        const sync = () => setPreferences(readPreferences())
        window.addEventListener('storage', sync)
        window.addEventListener(CHANGE_EVENT, sync)
        return () => {
            window.removeEventListener('storage', sync)
            window.removeEventListener(CHANGE_EVENT, sync)
        }
    }, [])

    const setPreference = useCallback((key: SessionListToolbarPreferenceKey, value: boolean) => {
        setPreferences((current) => {
            const next = { ...current, [key]: value }
            writePreferences(next)
            return next
        })
    }, [])

    return { preferences, setPreference }
}
