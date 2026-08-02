/**
 * Persisted set of session ids whose task just finished (transitioned from
 * working to idle) and has not been acknowledged by the user yet. Surfaced as
 * a green dot in the pinned "in progress" section until the session is opened.
 */
const STORAGE_KEY = 'hapi.completed-unseen'

export function readCompletedUnseen(): Set<string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) {
            return new Set()
        }
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) {
            return new Set()
        }
        return new Set(parsed.filter((item): item is string => typeof item === 'string'))
    } catch {
        return new Set()
    }
}

export function writeCompletedUnseen(set: ReadonlySet<string>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
    } catch {
        // Ignore storage errors (private mode, quota, …)
    }
}
