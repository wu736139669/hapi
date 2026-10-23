import { useState, type ComponentPropsWithoutRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { ImagePreview } from '@/components/ImagePreview'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { classifyNoSchemeHref } from '@/lib/markdown-href-policy'
import { resolveImageMimeType } from '@/lib/file-preview'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function ImageStatus(props: { label: string; message: string; onRetry?: () => void }) {
    const { t } = useTranslation()
    return (
        <span role="status" className="my-2 flex items-center gap-3 rounded-lg bg-[var(--app-subtle-bg)] px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{props.label}</span>
                <span className="block text-[var(--app-hint)]">{props.message}</span>
            </span>
            {props.onRetry ? (
                <button type="button" onClick={props.onRetry} className="shrink-0 rounded px-2 py-1 text-[var(--app-link)]">
                    {t('session.retry')}
                </button>
            ) : null}
        </span>
    )
}

function Preview(props: { src: string; label: string; className?: string; onRetry?: () => void }) {
    const { t } = useTranslation()
    const [failedSrc, setFailedSrc] = useState<string | null>(null)
    if (failedSrc === props.src) {
        return <ImageStatus label={props.label} message={t('media.image.loadFailed')} onRetry={() => {
            setFailedSrc(null)
            props.onRetry?.()
        }} />
    }
    return (
        <ImagePreview
            src={props.src}
            fileName={props.label}
            label={props.label}
            onImageError={() => setFailedSrc(props.src)}
            buttonClassName="group my-3 flex max-h-[32rem] min-h-[10rem] w-full items-center justify-center overflow-hidden rounded-xl bg-[var(--app-subtle-bg)] p-2 text-left"
            imageClassName={cn('aui-md-img max-h-[30rem] max-w-full object-contain transition-transform group-hover:scale-[1.01]', props.className)}
        />
    )
}

function SessionImage(props: { api: ApiClient; sessionId: string; path: string; mimeType: string; label: string; className?: string }) {
    const { t } = useTranslation()
    const query = useQuery({
        queryKey: queryKeys.sessionFile(props.sessionId, props.path),
        queryFn: () => props.api.readSessionFile(props.sessionId, props.path),
        staleTime: 60_000,
        retry: false,
    })
    const retry = () => { void query.refetch() }
    if (query.isPending || (query.isFetching && !query.data?.content)) {
        return <ImageStatus label={props.label} message={t('media.image.loading')} />
    }
    if (!query.data?.success || !query.data.content) {
        return <ImageStatus label={props.label} message={t('media.image.loadFailed')} onRetry={retry} />
    }
    const src = `data:${props.mimeType};base64,${query.data.content}`
    return <Preview src={src} label={props.label} className={props.className} onRetry={retry} />
}

/** Local Markdown paths belong to the agent machine, never to the web origin. */
export function MarkdownImage(props: ComponentPropsWithoutRef<'img'>) {
    const chat = useOptionalHappyChatContext()
    const { t } = useTranslation()
    const src = typeof props.src === 'string' ? props.src : ''
    const label = props.alt || t('media.displayed.image')
    if (!src) return <ImageStatus label={label} message={t('media.image.loadFailed')} />

    const localPath = /^[A-Za-z]:(?:[\\/]|%5c|%2f)/i.test(src)
        || !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)
    if (chat && localPath) {
        const decision = classifyNoSchemeHref(src, { workspacePath: chat.metadata?.path })
        const mimeType = decision.action === 'file' ? resolveImageMimeType(decision.path) : null
        if (decision.action !== 'file' || !mimeType) {
            // Outside-workspace media must be sent through the permission-gated
            // display_image tool; Markdown text cannot grant filesystem access.
            return <ImageStatus label={label} message={t('media.image.localUnavailable')} />
        }
        return <SessionImage key={`${chat.sessionId}:${decision.path}`} api={chat.api} sessionId={chat.sessionId} path={decision.path} mimeType={mimeType} label={label} className={props.className} />
    }

    return <Preview key={src} src={src} label={label} className={props.className} />
}
