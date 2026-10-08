/** Display-only agent payloads. Preserve user inputs verbatim. This is shared
 * by the CLI and Hub so truncation happens before network transmission too. */
export const TRUNCATE_STRING_LIMIT = 64 * 1024
const TRUNCATE_HEAD = 48 * 1024
const TRUNCATE_TAIL = 12 * 1024

function truncateDeep(value: unknown): unknown {
    if (typeof value === 'string') {
        if (value.length <= TRUNCATE_STRING_LIMIT) return value
        const removed = value.length - TRUNCATE_HEAD - TRUNCATE_TAIL
        return `${value.slice(0, TRUNCATE_HEAD)}\n…[hapi: truncated ${removed} chars]…\n${value.slice(value.length - TRUNCATE_TAIL)}`
    }
    if (Array.isArray(value)) {
        let copy: unknown[] | null = null
        for (let i = 0; i < value.length; i++) {
            const item = truncateDeep(value[i])
            if (item !== value[i]) { copy ??= value.slice(); copy[i] = item }
        }
        return copy ?? value
    }
    if (value !== null && typeof value === 'object') {
        const original = value as Record<string, unknown>
        let copy: Record<string, unknown> | null = null
        for (const key of Object.keys(original)) {
            const item = truncateDeep(original[key])
            if (item !== original[key]) { copy ??= { ...original }; copy[key] = item }
        }
        return copy ?? value
    }
    return value
}

export function truncateOversizedMessageContent(content: unknown): unknown {
    if (content === null || typeof content !== 'object' || (content as Record<string, unknown>).role !== 'agent') return content
    return truncateDeep(content)
}
