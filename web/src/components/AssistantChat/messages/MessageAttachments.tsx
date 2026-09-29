import { useCallback, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { AttachmentMetadata } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { isImageMimeType } from '@/lib/fileAttachments'
import { ImagePreview } from '@/components/ImagePreview'

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const MAX_CACHED_ORIGINALS = 50
const originalUrlCache = new Map<string, string>()

function rememberOriginal(key: string, objectUrl: string): void {
    originalUrlCache.delete(key)
    originalUrlCache.set(key, objectUrl)
    while (originalUrlCache.size > MAX_CACHED_ORIGINALS) {
        const oldest = originalUrlCache.entries().next().value as [string, string] | undefined
        if (!oldest) break
        originalUrlCache.delete(oldest[0])
        URL.revokeObjectURL(oldest[1])
    }
}

function ImageAttachment(props: { attachment: AttachmentMetadata; api?: ApiClient; sessionId?: string }) {
    const { attachment } = props
    const [fullSrc, setFullSrc] = useState<string | undefined>(undefined)

    // Viewer opens with the inline thumbnail and upgrades to the hub-served
    // original once it loads; old messages without a hub copy keep the thumb.
    const requestFullSize = useCallback(() => {
        const { api, sessionId } = props
        const attachmentUrl = attachment.attachmentUrl
        if (fullSrc || !attachmentUrl || !api || !sessionId) return
        const cached = originalUrlCache.get(attachmentUrl)
        if (cached) {
            setFullSrc(cached)
            return
        }
        void (async () => {
            try {
                const blob = await api.getSessionAttachmentBlob(sessionId, attachment.id)
                const objectUrl = URL.createObjectURL(blob)
                rememberOriginal(attachmentUrl, objectUrl)
                setFullSrc(objectUrl)
            } catch {
                // Original unavailable; the thumbnail stays as the best view.
            }
        })()
    }, [attachment.attachmentUrl, attachment.id, fullSrc, props])

    return (
        <ImagePreview
            src={attachment.previewUrl ?? ''}
            fullSrc={fullSrc}
            fileName={attachment.filename}
            label={attachment.filename}
            buttonClassName="relative overflow-hidden rounded-lg text-left cursor-zoom-in"
            imageClassName="max-h-48 max-w-full object-contain"
            onTriggerClick={requestFullSize}
            caption={(
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                    <span className="text-xs text-white/90 line-clamp-1">
                        {attachment.filename}
                    </span>
                </div>
            )}
        />
    )
}

function FileAttachment(props: { attachment: AttachmentMetadata }) {
    const { attachment } = props
    return (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--app-bg)] px-3 py-2">
            <FileIcon fileName={attachment.filename} size={24} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-base font-medium text-[var(--app-fg)]">
                    {attachment.filename}
                </div>
                <div className="text-xs text-[var(--app-hint)]">
                    {formatFileSize(attachment.size)}
                </div>
            </div>
        </div>
    )
}

export function MessageAttachments(props: { attachments: AttachmentMetadata[]; api?: ApiClient; sessionId?: string }) {
    const { attachments } = props
    if (!attachments || attachments.length === 0) return null

    const images = attachments.filter(a => isImageMimeType(a.mimeType) && a.previewUrl)
    const files = attachments.filter(a => !isImageMimeType(a.mimeType) || !a.previewUrl)

    return (
        <div className="mt-2 flex flex-col gap-2">
            {images.length > 0 && (
                <div
                    className="hapi-share-media-grid flex flex-wrap gap-2"
                    data-hapi-image-count={images.length}
                >
                    {images.map(attachment => (
                        <ImageAttachment key={attachment.id} attachment={attachment} api={props.api} sessionId={props.sessionId} />
                    ))}
                </div>
            )}
            {files.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    {files.map(attachment => (
                        <FileAttachment key={attachment.id} attachment={attachment} />
                    ))}
                </div>
            )}
        </div>
    )
}
