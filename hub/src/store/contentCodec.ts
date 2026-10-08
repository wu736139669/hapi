import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'

/** JSON payloads at or above this many chars are stored zstd-compressed (BLOB).
 *  Below it the plaintext JSON is kept: zstd gains little on tiny strings and
 *  plaintext rows stay grep-able when inspecting the DB by hand. */
export const COMPRESS_MIN_CHARS = 256

export { TRUNCATE_STRING_LIMIT, truncateOversizedMessageContent } from '@hapi/protocol'
import { truncateOversizedMessageContent } from '@hapi/protocol'

/** Compress a JSON string for the messages.content column.
 *  Storage contract: TEXT value = plaintext JSON, BLOB value = zstd(JSON). */
export function compressContentJson(json: string): string | Buffer {
    if (json.length < COMPRESS_MIN_CHARS) return json
    const compressed = zstdCompressSync(Buffer.from(json, 'utf8'))
    // Guard against incompressible payloads (already-compressed base64 etc.)
    return compressed.length < Buffer.byteLength(json, 'utf8') ? compressed : json
}

export function encodeMessageContent(content: unknown): string | Buffer {
    return compressContentJson(JSON.stringify(content))
}

function safeParse(json: string): unknown | null {
    try {
        return JSON.parse(json) as unknown
    } catch {
        return null
    }
}

/** Inverse of encodeMessageContent; tolerant like safeJsonParse (null on any
 *  malformed row) because readers treat content as best-effort display data. */
export function decodeMessageContent(raw: string | Uint8Array | null): unknown | null {
    if (raw === null) return null
    if (typeof raw === 'string') return safeParse(raw)
    try {
        return safeParse(zstdDecompressSync(raw).toString('utf8'))
    } catch {
        return null
    }
}
