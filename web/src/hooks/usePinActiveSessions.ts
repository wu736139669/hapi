import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'hapi-pin-active-sessions'

function readPreference(): boolean {
    if (typeof window === 'undefined') return false
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
        return false
    }
}

export function usePinActiveSessions(): {
    pinActiveSessions: boolean
    setPinActiveSessions: (value: boolean) => void
} {
    const [pinActiveSessions, setPinActiveSessionsState] = useState(readPreference)

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key === STORAGE_KEY) {
                setPinActiveSessionsState(event.newValue === 'true')
            }
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setPinActiveSessions = useCallback((value: boolean) => {
        setPinActiveSessionsState(value)
        try {
            if (value) {
                localStorage.setItem(STORAGE_KEY, 'true')
            } else {
                localStorage.removeItem(STORAGE_KEY)
            }
        } catch {
            // Ignore storage errors.
        }
    }, [])

    return { pinActiveSessions, setPinActiveSessions }
}
