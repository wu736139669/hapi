import { describe, expect, it } from 'vitest'
import { readBlobWithProgress } from './readBlobWithProgress'

/** jsdom Blob lacks arrayBuffer(); read through FileReader instead. */
function blobBytes(blob: Blob): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(blob)
    })
}

function streamResponse(chunks: Uint8Array[], total?: number): Response {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(chunk)
            }
            controller.close()
        }
    })
    const headers = new Headers({ 'content-type': 'video/mp4' })
    if (total !== undefined) {
        headers.set('content-length', String(total))
    }
    return new Response(body, { headers })
}

describe('readBlobWithProgress', () => {
    it('reports byte progress and preserves the content type', async () => {
        const progress: Array<[number, number | null]> = []
        const blob = await readBlobWithProgress(
            streamResponse([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])], 5),
            (loaded, total) => progress.push([loaded, total])
        )

        expect(progress).toEqual([[2, 5], [5, 5]])
        expect(blob.type).toBe('video/mp4')
        expect(await blobBytes(blob)).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    })

    it('reports a null total when content-length is missing', async () => {
        const progress: Array<[number, number | null]> = []
        const blob = await readBlobWithProgress(
            streamResponse([new Uint8Array([7])]),
            (loaded, total) => progress.push([loaded, total])
        )

        expect(progress).toEqual([[1, null]])
        expect(await blobBytes(blob)).toEqual(new Uint8Array([7]))
    })

    it('reads a plain blob when no reporter is given', async () => {
        const response = new Response(new Uint8Array([9, 9]))
        const blob = await readBlobWithProgress(response)
        expect(blob.size).toBe(2)
    })
})
