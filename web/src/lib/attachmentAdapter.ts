import type { AttachmentAdapter, PendingAttachment, CompleteAttachment, Attachment } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { AttachmentMetadata } from '@/types/api'
import { isImageMimeType } from '@/lib/fileAttachments'
import { randomId } from '@/lib/randomId'
import { createImageThumbnailDataUrl } from '@/lib/imageThumbnail'
import { getRestoredUploadMetadata } from '@/lib/composer-attachment-drafts'
import type { AttachmentDraftHandoff } from '@/lib/composer-draft-transfer'

/** Composer / share upload ceiling — keep deep-link fetch in sync. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

type PendingUploadAttachment = PendingAttachment & {
    path?: string
    previewUrl?: string
    attachmentUrl?: string
    uploadSessionId?: string
}

export function createAttachmentAdapter(
    api: ApiClient,
    sessionId: string,
    resolveSessionId?: () => Promise<string>,
    // Always hand off after resume merges into a new session id — even when
    // the pick is cancelled — so the caller can navigate off a deleted source.
    // Cancellation is re-checked at transfer save time via isCancelled().
    onSessionResolved?: (sessionId: string, pending: AttachmentDraftHandoff) => Promise<void>,
): AttachmentAdapter {
    const cancelledAttachmentIds = new Set<string>()

    const deleteUpload = async (path?: string, uploadSessionId = sessionId, attachmentId?: string) => {
        if (!path) return
        try {
            await api.deleteUploadFile(uploadSessionId, path, attachmentId)
        } catch {
            // Best effort cleanup
        }
    }

    return {
        // assistant-ui uses the exact "*" sentinel for an allow-all adapter.
        // "*/*" is forwarded to MIME matching and rejects every file before
        // this adapter's add() method can run.
        accept: '*',

        async *add({ file }): AsyncGenerator<PendingAttachment> {
            // Upload paths are scoped to the session that created them. An
            // inactive composer may resume into a different session id, so its
            // persisted file must follow the normal resolve/transfer flow and
            // be uploaded again by the resumed composer. Pathless restored
            // metadata still supplies a stable id so draft merge cannot
            // duplicate the same File across persistence passes.
            const restored = getRestoredUploadMetadata(file)
            if (!resolveSessionId && restored?.path) {
                yield {
                    id: restored.id,
                    type: 'file',
                    name: file.name,
                    contentType: file.type || 'application/octet-stream',
                    file,
                    status: { type: 'requires-action', reason: 'composer-send' },
                    path: restored.path,
                    previewUrl: restored.previewUrl,
                    attachmentUrl: restored.attachmentUrl,
                    uploadSessionId: restored.uploadSessionId,
                } as PendingUploadAttachment
                return
            }

            const id = restored?.id ?? randomId()
            const contentType = file.type || 'application/octet-stream'

            try {
                let previewUrl: string | undefined
                if (isImageMimeType(contentType)) {
                    // Small thumbnail only: the original travels to the hub as a
                    // separate cached attachment, never inside the message JSON.
                    previewUrl = await createImageThumbnailDataUrl(file) ?? undefined
                }

                yield {
                    id,
                    type: 'file',
                    name: file.name,
                    contentType,
                    file,
                    status: { type: 'running', reason: 'uploading', progress: 0 },
                    previewUrl
                } as PendingUploadAttachment

                if (cancelledAttachmentIds.has(id)) {
                    return
                }

                if (file.size > MAX_UPLOAD_BYTES) {
                    yield {
                        id,
                        type: 'file',
                        name: file.name,
                        contentType,
                        file,
                        status: { type: 'incomplete', reason: 'error' }
                    }
                    return
                }

                const uploadSessionId = resolveSessionId ? await resolveSessionId() : sessionId
                // Resume may already have merged the source session away. Always
                // hand off with a live cancellation predicate so transfer can
                // drop this id (even if already persisted on the source draft).
                if (uploadSessionId !== sessionId && onSessionResolved) {
                    await onSessionResolved(uploadSessionId, {
                        id,
                        file,
                        previewUrl,
                        isCancelled: () => cancelledAttachmentIds.has(id),
                    })
                    return
                }
                if (cancelledAttachmentIds.has(id)) {
                    return
                }

                // Upload the original bytes; the wire preview stays a thumbnail.
                const content = await fileToBase64(file)

                if (cancelledAttachmentIds.has(id)) {
                    return
                }

                yield {
                    id,
                    type: 'file',
                    name: file.name,
                    contentType,
                    file,
                    status: { type: 'running', reason: 'uploading', progress: 50 },
                    previewUrl
                } as PendingUploadAttachment

                const result = await api.uploadFile(uploadSessionId, file.name, content, contentType, id)
                if (cancelledAttachmentIds.has(id)) {
                    if (result.success && result.path) {
                        await deleteUpload(result.path, uploadSessionId, id)
                    }
                    return
                }

                if (!result.success || !result.path) {
                    yield {
                        id,
                        type: 'file',
                        name: file.name,
                        contentType,
                        file,
                        status: { type: 'incomplete', reason: 'error' }
                    }
                    return
                }

                yield {
                    id,
                    type: 'file',
                    name: file.name,
                    contentType,
                    file,
                    status: { type: 'requires-action', reason: 'composer-send' },
                    path: result.path,
                    previewUrl,
                    attachmentUrl: result.attachmentUrl,
                    uploadSessionId,
                } as PendingUploadAttachment

            } catch {
                yield {
                    id,
                    type: 'file',
                    name: file.name,
                    contentType,
                    file,
                    status: { type: 'incomplete', reason: 'error' }
                }
            }
        },

        async remove(attachment: Attachment): Promise<void> {
            cancelledAttachmentIds.add(attachment.id)
            const path = (attachment as PendingUploadAttachment).path
            const uploadSessionId = (attachment as PendingUploadAttachment).uploadSessionId
            await deleteUpload(path, uploadSessionId, attachment.id)
        },

        async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
            const pending = attachment as PendingUploadAttachment
            const path = pending.path

            // Build AttachmentMetadata to be sent with the message
            const metadata: AttachmentMetadata | undefined = path ? {
                id: attachment.id,
                filename: attachment.name,
                mimeType: attachment.contentType ?? 'application/octet-stream',
                size: attachment.file?.size ?? 0,
                path,
                previewUrl: pending.previewUrl,
                ...(pending.attachmentUrl ? { attachmentUrl: pending.attachmentUrl } : {})
            } : undefined

            return {
                id: attachment.id,
                type: attachment.type,
                name: attachment.name,
                contentType: attachment.contentType,
                status: { type: 'complete' },
                // Store metadata as JSON in the text content for extraction by assistant-runtime
                content: metadata ? [{ type: 'text', text: JSON.stringify({ __attachmentMetadata: metadata }) }] : []
            }
        }
    }
}

async function fileToBase64(file: File): Promise<string> {
    return base64FromDataUrl(await fileToDataUrl(file))
}

function base64FromDataUrl(dataUrl: string): string {
    const separatorIndex = dataUrl.indexOf(',')
    const base64 = separatorIndex >= 0 ? dataUrl.slice(separatorIndex + 1) : ''
    if (!base64) {
        throw new Error('Failed to read file')
    }
    return base64
}

async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            resolve(reader.result as string)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}
