import { useCallback, useEffect, useState } from 'react'

export const DEFAULT_SHOW_UNAVAILABLE_AGENTS = false

const STORAGE_KEY = 'hapi-show-unavailable-agents'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}
function readPreference(): boolean {
    if (!isBrowser()) return DEFAULT_SHOW_UNAVAILABLE_AGENTS
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
        return DEFAULT_SHOW_UNAVAILABLE_AGENTS
    }
}

export function useShowUnavailableAgents(): {
    showUnavailableAgents: boolean
    setShowUnavailableAgents: (value: boolean) => void
} {
    const [showUnavailableAgents, setShowUnavailableAgentsState] = useState(readPreference)

    useEffect(() => {
        if (!isBrowser()) return
        const onStorage = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY) {
                setShowUnavailableAgentsState(event.newValue === 'true')
            }
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setShowUnavailableAgents = useCallback((value: boolean) => {
        setShowUnavailableAgentsState(value)
        if (!isBrowser()) return
        try {
            if (value === DEFAULT_SHOW_UNAVAILABLE_AGENTS) {
                localStorage.removeItem(STORAGE_KEY)
            } else {
                localStorage.setItem(STORAGE_KEY, String(value))
            }
        } catch {
            // Ignore storage errors.
        }
    }, [])

    return { showUnavailableAgents, setShowUnavailableAgents }
}
