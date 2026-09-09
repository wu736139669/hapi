export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    apng: 'image/apng',
    avif: 'image/avif',
    bmp: 'image/bmp',
    gif: 'image/gif',
    ico: 'image/x-icon',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    webp: 'image/webp'
}

export function resolveImageMimeType(path: string): string | null {
    const extension = path.split('.').pop()?.toLowerCase()
    return extension ? IMAGE_MIME_BY_EXTENSION[extension] ?? null : null
}

export function isHtmlFile(path: string): boolean {
    const extension = path.split('.').pop()?.toLowerCase()
    return extension === 'html' || extension === 'htm'
}

export function isMarkdownFile(path: string): boolean {
    const extension = path.split('.').pop()?.toLowerCase()
    return extension === 'md' || extension === 'markdown' || extension === 'mdown' || extension === 'mkdn'
}

export function isPreviewableFilePath(path: string): boolean {
    return Boolean(resolveImageMimeType(path) || isHtmlFile(path) || isMarkdownFile(path))
}

const RESPONSIVE_VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1">'

/** Add a mobile viewport without changing a document that already declares one. */
export function prepareHtmlDocument(content: string): string {
    if (/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(content)) {
        return content
    }

    const headTag = content.match(/<head\b[^>]*>/i)
    if (headTag?.index !== undefined) {
        const end = headTag.index + headTag[0].length
        return `${content.slice(0, end)}\n${RESPONSIVE_VIEWPORT_META}${content.slice(end)}`
    }

    const htmlTag = content.match(/<html\b[^>]*>/i)
    if (htmlTag?.index !== undefined) {
        const end = htmlTag.index + htmlTag[0].length
        return `${content.slice(0, end)}\n<head>${RESPONSIVE_VIEWPORT_META}</head>${content.slice(end)}`
    }

    return `<!doctype html><html><head>${RESPONSIVE_VIEWPORT_META}</head><body>${content}</body></html>`
}
