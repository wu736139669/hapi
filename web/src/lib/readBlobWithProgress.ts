export type BlobProgressReporter = (loaded: number, total: number | null) => void

/**
 * Read a response body into a Blob while reporting byte progress.
 *
 * Large generated media (videos) can take a minute over a slow runner
 * tunnel; `res.blob()` gives no feedback, so callers can surface a
 * determinate progress bar when the hub sent Content-Length.
 */
export async function readBlobWithProgress(response: Response, onProgress?: BlobProgressReporter): Promise<Blob> {
    if (!onProgress || !response.body) {
        return await response.blob()
    }

    const header = response.headers.get('content-length')
    const parsed = header === null ? Number.NaN : Number(header)
    const total = Number.isFinite(parsed) && parsed > 0 ? parsed : null

    const reader = response.body.getReader()
    const chunks: BlobPart[] = []
    let loaded = 0
    for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        chunks.push(value as unknown as BlobPart)
        loaded += value.byteLength
        onProgress(loaded, total)
    }

    const type = response.headers.get('content-type')
    return new Blob(chunks, type ? { type } : undefined)
}
