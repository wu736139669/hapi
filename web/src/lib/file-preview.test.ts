import { describe, expect, it } from 'vitest'
import { isHtmlFile, isMarkdownFile, isPreviewableFilePath, prepareHtmlDocument, resolveImageMimeType } from './file-preview'

describe('file preview helpers', () => {
    it('recognizes markdown, HTML, and image files', () => {
        expect(isMarkdownFile('docs/README.md')).toBe(true)
        expect(isHtmlFile('dist/index.HTML')).toBe(true)
        expect(resolveImageMimeType('assets/photo.webp')).toBe('image/webp')
        expect(isPreviewableFilePath('assets/photo.webp')).toBe(true)
        expect(isPreviewableFilePath('src/main.ts')).toBe(false)
    })

    it('adds a viewport to HTML documents without changing an existing one', () => {
        const prepared = prepareHtmlDocument('<html><head></head><body>Hello</body></html>')
        expect(prepared).toContain('name="viewport"')

        const existing = '<meta name="viewport" content="width=device-width">'
        expect(prepareHtmlDocument(existing)).toBe(existing)
    })
})
