// Media bytes addressed by an immutable id/fingerprint never change, so they
// are cached for a year as immutable (generated images, chat attachments).
export const IMMUTABLE_MEDIA_CACHE_CONTROL = 'private, max-age=31536000, immutable'

// Weak comparison of an If-None-Match header against our ETag (handles lists, `*`, and W/ prefixes).
export function ifNoneMatchMatches(header: string | undefined, etag: string): boolean {
    if (!header) {
        return false
    }
    const normalized = etag.replace(/^W\//, '')
    return header.split(',').some((candidate) => {
        const trimmed = candidate.trim()
        return trimmed === '*' || trimmed.replace(/^W\//, '') === normalized
    })
}
