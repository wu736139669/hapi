import { useCallback, useEffect, useState } from 'react'

/**
 * Whether assistant reasoning, tool activity, and intermediate output should
 * be grouped into the compact Execution process panel.
 *
 * This is intentionally a client-local preference: it controls presentation
 * only and must not change the messages persisted by the hub.
 */
export const DEFAULT_EXECUTION_PROCESS_ENABLED = true

const EXECUTION_PROCESS_ENABLED_STORAGE_KEY = 'hapi-execution-process-enabled'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function readStoredValue(): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(EXECUTION_PROCESS_ENABLED_STORAGE_KEY)
    } catch {
        return null
    }
}

function writeStoredValue(value: boolean): void {
    if (!isBrowser()) return
    try {
        if (value === DEFAULT_EXECUTION_PROCESS_ENABLED) {
            localStorage.removeItem(EXECUTION_PROCESS_ENABLED_STORAGE_KEY)
        } else {
            localStorage.setItem(EXECUTION_PROCESS_ENABLED_STORAGE_KEY, String(value))
        }
    } catch {
        // Ignore storage errors; the in-memory setting remains usable.
    }
}

function parseExecutionProcessEnabled(raw: string | null): boolean {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return DEFAULT_EXECUTION_PROCESS_ENABLED
}

export function getInitialExecutionProcessEnabled(): boolean {
    return parseExecutionProcessEnabled(readStoredValue())
}

export function useExecutionProcess(): {
    executionProcessEnabled: boolean
    setExecutionProcessEnabled: (value: boolean) => void
} {
    const [executionProcessEnabled, setExecutionProcessEnabledState] = useState<boolean>(getInitialExecutionProcessEnabled)

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key !== EXECUTION_PROCESS_ENABLED_STORAGE_KEY) return
            setExecutionProcessEnabledState(parseExecutionProcessEnabled(event.newValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setExecutionProcessEnabled = useCallback((value: boolean) => {
        setExecutionProcessEnabledState(value)
        writeStoredValue(value)
    }, [])

    return { executionProcessEnabled, setExecutionProcessEnabled }
}

