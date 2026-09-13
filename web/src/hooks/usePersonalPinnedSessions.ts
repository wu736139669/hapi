import { useCallback, useEffect, useState } from 'react'

const PERSONAL_PINNED_SESSIONS_STORAGE_KEY = 'hapi-personal-pinned-sessions-v1'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) return
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors; the in-memory state still works for this tab.
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) return
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors.
    }
}

function parsePersonalPinnedSessions(raw: string | null): Set<string> {
    if (!raw) return new Set()
    try {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return new Set()
        return new Set(
            parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        )
    } catch {
        return new Set()
    }
}

function serializePersonalPinnedSessions(sessionIds: ReadonlySet<string>): string {
    return JSON.stringify([...sessionIds].sort())
}

export function getInitialPersonalPinnedSessions(): Set<string> {
    return parsePersonalPinnedSessions(safeGetItem(PERSONAL_PINNED_SESSIONS_STORAGE_KEY))
}

export function usePersonalPinnedSessions(): {
    personalPinnedSessionIds: ReadonlySet<string>
    setPersonalPinned: (sessionId: string, pinned: boolean) => void
    transferPersonalPinned: (fromSessionId: string, toSessionId: string) => void
} {
    const [personalPinnedSessionIds, setPersonalPinnedSessionIds] = useState<Set<string>>(
        getInitialPersonalPinnedSessions
    )

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key !== PERSONAL_PINNED_SESSIONS_STORAGE_KEY) return
            setPersonalPinnedSessionIds(parsePersonalPinnedSessions(event.newValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    useEffect(() => {
        if (personalPinnedSessionIds.size === 0) {
            safeRemoveItem(PERSONAL_PINNED_SESSIONS_STORAGE_KEY)
        } else {
            safeSetItem(
                PERSONAL_PINNED_SESSIONS_STORAGE_KEY,
                serializePersonalPinnedSessions(personalPinnedSessionIds)
            )
        }
    }, [personalPinnedSessionIds])

    const setPersonalPinned = useCallback((sessionId: string, pinned: boolean) => {
        const normalizedId = sessionId.trim()
        if (!normalizedId) return

        setPersonalPinnedSessionIds(previous => {
            const next = new Set(previous)
            if (pinned) {
                next.add(normalizedId)
            } else {
                next.delete(normalizedId)
            }
            return next
        })
    }, [])

    const transferPersonalPinned = useCallback((fromSessionId: string, toSessionId: string) => {
        const fromId = fromSessionId.trim()
        const toId = toSessionId.trim()
        if (!fromId || !toId || fromId === toId) return

        setPersonalPinnedSessionIds(previous => {
            if (!previous.has(fromId)) return previous
            const next = new Set(previous)
            next.delete(fromId)
            next.add(toId)
            return next
        })
    }, [])

    return { personalPinnedSessionIds, setPersonalPinned, transferPersonalPinned }
}
