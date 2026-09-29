import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    buildChatAttachmentStorageKey,
    deleteChatAttachmentFile,
    readChatAttachmentFile,
    resolveChatAttachmentStoragePath,
    writeChatAttachmentFile
} from './storage'

describe('chat attachment storage', () => {
    it('writes, reads and deletes original bytes with a sha256 fingerprint', async () => {
        const home = mkdtempSync(join(tmpdir(), 'hapi-chat-att-'))
        try {
            const buffer = Buffer.from('image-bytes')
            const { storageKey, sha256, size } = await writeChatAttachmentFile(
                home,
                'session-1',
                'att-1',
                'photo.png',
                buffer
            )
            expect(storageKey).toBe('session-1/att-1-photo.png')
            expect(sha256).toHaveLength(64)
            expect(size).toBe(buffer.length)

            const read = await readChatAttachmentFile(home, storageKey)
            expect(read?.toString()).toBe('image-bytes')

            await deleteChatAttachmentFile(home, storageKey)
            expect(await readChatAttachmentFile(home, storageKey)).toBeNull()
        } finally {
            rmSync(home, { recursive: true, force: true })
        }
    })

    it('rejects storage keys that escape the attachments root', () => {
        const home = mkdtempSync(join(tmpdir(), 'hapi-chat-att-'))
        try {
            expect(() => resolveChatAttachmentStoragePath(home, '../escape.png')).toThrow(
                'Invalid chat attachment path'
            )
            expect(() => resolveChatAttachmentStoragePath(home, 'session/../../escape.png')).toThrow(
                'Invalid chat attachment path'
            )
        } finally {
            rmSync(home, { recursive: true, force: true })
        }
    })

    it('sanitizes path separators and traversal in ids and filenames', () => {
        const key = buildChatAttachmentStorageKey('s/1', 'a..b', '../../x.png')
        expect(key.startsWith('s_1/')).toBe(true)
        const filePart = key.slice('s_1/'.length)
        expect(filePart).not.toContain('..')
        expect(filePart).not.toContain('/')
        expect(filePart.endsWith('x.png')).toBe(true)
    })
})
