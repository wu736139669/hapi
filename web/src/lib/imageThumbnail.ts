const MAX_THUMBNAIL_EDGE = 768
const WEBP_QUALITY = 0.8
const JPEG_QUALITY = 0.85

/**
 * Downscale an image file into a small data-URL thumbnail for the chat payload.
 *
 * Full-size previews used to be stored inline in the message JSON, which made
 * every conversation load transfer megabytes of base64. The wire preview is now
 * a compact thumbnail; the original is served separately by the hub.
 *
 * Returns null when the browser cannot decode the image (e.g. unsupported
 * format or a non-DOM test environment); callers fall back to a file card.
 */
export async function createImageThumbnailDataUrl(file: File): Promise<string | null> {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
        return null
    }
    let bitmap: ImageBitmap
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
        return null
    }
    try {
        const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(bitmap.width, bitmap.height))
        const width = Math.max(1, Math.round(bitmap.width * scale))
        const height = Math.max(1, Math.round(bitmap.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) return null
        context.drawImage(bitmap, 0, 0, width, height)
        const webp = canvas.toDataURL('image/webp', WEBP_QUALITY)
        if (webp.startsWith('data:image/webp')) return webp
        return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    } catch {
        return null
    } finally {
        bitmap.close()
    }
}
