import { constantTimeEquals } from './crypto'

export const DEFAULT_NAMESPACE = 'default'

export type ParsedAccessToken = {
    baseToken: string
    namespace: string
}

type StoredAccessTokenLookup = {
    resolve: (rawToken: string) => { namespace: string } | null
}

export function parseAccessToken(raw: string): ParsedAccessToken | null {
    if (!raw) {
        return null
    }

    const trimmed = raw.trim()
    if (!trimmed) {
        return null
    }

    const separatorIndex = trimmed.lastIndexOf(':')
    if (separatorIndex === -1) {
        return { baseToken: trimmed, namespace: DEFAULT_NAMESPACE }
    }

    const baseToken = trimmed.slice(0, separatorIndex)
    const namespace = trimmed.slice(separatorIndex + 1)
    if (!baseToken || !namespace) {
        return null
    }

    if (baseToken.trim() !== baseToken || namespace.trim() !== namespace) {
        return null
    }

    return { baseToken, namespace }
}

/**
 * Resolve either a per-user Team-HAPI credential or the legacy hub token.
 * The legacy path remains available for the hub owner; user credentials never
 * expose the shared base token and cannot select another namespace by editing
 * a suffix.
 */
export function resolveAccessToken(
    raw: string,
    baseToken: string,
    stored?: StoredAccessTokenLookup
): ParsedAccessToken | null {
    const storedToken = stored?.resolve(raw)
    if (storedToken) {
        return { baseToken: raw, namespace: storedToken.namespace }
    }

    const parsed = parseAccessToken(raw)
    if (!parsed || !constantTimeEquals(parsed.baseToken, baseToken)) {
        return null
    }
    return parsed
}
