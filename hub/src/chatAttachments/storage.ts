import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve, sep } from 'node:path'

import { getHapiHomeDir } from '../scratchlistAttachments/storage'

export { getHapiHomeDir }

function sanitizeSegment(segment: string): string {
    return segment.replace(/[/\\]/g, '_').replace(/\.\./g, '_').slice(0, 128)
}

function sanitizeFilename(filename: string): string {
    const sanitized = filename
        .replace(/[/\\]/g, '_')
        .replace(/\.\./g, '_')
        .replace(/[\r\n\0"\\]/g, '_')
        .replace(/[\u0000-\u001f\u007f]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 200)
    return sanitized || 'attachment'
}

export function getChatAttachmentsRoot(hapiHome: string = getHapiHomeDir()): string {
    return join(hapiHome, 'attachments')
}

export function buildChatAttachmentStorageKey(
    sessionId: string,
    attachmentId: string,
    filename: string
): string {
    return `${sanitizeSegment(sessionId)}/${sanitizeSegment(attachmentId)}-${sanitizeFilename(filename)}`
}

export function resolveChatAttachmentStoragePath(hapiHome: string, storageKey: string): string {
    const root = resolve(getChatAttachmentsRoot(hapiHome))
    const resolved = resolve(root, storageKey)
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`
    if (!resolved.startsWith(prefix)) {
        throw new Error('Invalid chat attachment path')
    }
    return resolved
}

/** Persist the original bytes of a chat image attachment; idempotent per id. */
export async function writeChatAttachmentFile(
    hapiHome: string,
    sessionId: string,
    attachmentId: string,
    filename: string,
    buffer: Buffer
): Promise<{ storageKey: string; sha256: string; size: number }> {
    const storageKey = buildChatAttachmentStorageKey(sessionId, attachmentId, filename)
    const filePath = resolveChatAttachmentStoragePath(hapiHome, storageKey)
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, buffer)
    return {
        storageKey,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        size: buffer.length
    }
}

export async function readChatAttachmentFile(
    hapiHome: string,
    storageKey: string
): Promise<Buffer | null> {
    try {
        const filePath = resolveChatAttachmentStoragePath(hapiHome, storageKey)
        return await readFile(filePath)
    } catch {
        return null
    }
}

export async function deleteChatAttachmentFile(
    hapiHome: string,
    storageKey: string
): Promise<boolean> {
    try {
        const filePath = resolveChatAttachmentStoragePath(hapiHome, storageKey)
        await rm(filePath, { force: true })
        return true
    } catch {
        return false
    }
}
