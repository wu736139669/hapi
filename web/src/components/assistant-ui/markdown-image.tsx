import { useEffect, useState, type ComponentPropsWithoutRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { ImagePreview } from '@/components/ImagePreview'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { classifyNoSchemeHref } from '@/lib/markdown-href-policy'
import { resolveImageMimeType } from '@/lib/file-preview'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import {
    getMarkdownImageMimeType,
    MAX_MARKDOWN_IMAGE_BYTES,
    resolveMarkdownFileImage,
    type MarkdownAssetTarget,
} from '@/lib/markdown-file-assets'

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

type ChatMarkdownImageTarget = Extract<MarkdownAssetTarget, { kind: 'local' | 'remote' | 'inert' }>

function resolveChatMarkdownImage(src: string, workspacePath: string | null | undefined): ChatMarkdownImageTarget {
    const target = resolveMarkdownFileImage('.hapi-chat-message.md', src, { workspacePath })
    if (target.kind === 'local' || target.kind === 'remote') return target
    return { kind: 'inert', href: src }
}

function markdownImageFallback(props: { label?: string; source: string; className?: string }) {
    return (
        <span
            role="img"
            aria-label={props.label || 'Image unavailable'}
            title={props.source}
            data-hapi-markdown-image-fallback="true"
            className={cn('aui-md-img-fallback my-3 text-[var(--app-hint)]', props.className)}
        >
            {props.label || 'Image unavailable'}
        </span>
    )
}

function markdownImageLoading(props: { label?: string; className?: string }) {
    return (
        <span
            role="img"
            aria-label={props.label || 'Loading image'}
            data-hapi-markdown-image-loading="true"
            className={cn('aui-md-img-loading my-3 text-[var(--app-hint)]', props.className)}
        >
            {props.label || 'Loading image'}
        </span>
    )
}

export function ChatMarkdownImage(props: ComponentPropsWithoutRef<'img'>) {
    const { src, alt, onError, className, ...imageProps } = props
    const chat = useOptionalHappyChatContext()
    const workspacePath = chat?.metadata?.path ?? null
    const source = typeof src === 'string'
        ? resolveChatMarkdownImage(src, workspacePath)
        : { kind: 'inert', href: '' } as const
    const localPath = source.kind === 'local' ? source.path : null
    const sourceKey = source.kind === 'local' ? source.path : source.href
    const api = chat?.api
    const sessionId = chat?.sessionId
    const [state, setState] = useState<{ key: string; dataUrl: string | null; failed: boolean }>(() => ({
        key: sourceKey,
        dataUrl: null,
        failed: source.kind === 'inert' || (source.kind === 'local' && (!api || !sessionId)),
    }))

    useEffect(() => {
        let active = true
        if (!localPath || !api || !sessionId) {
            setState({ key: sourceKey, dataUrl: null, failed: source.kind !== 'remote' })
            return () => {
                active = false
            }
        }

        setState({ key: sourceKey, dataUrl: null, failed: false })
        void api.readSessionFile(sessionId, localPath, MAX_MARKDOWN_IMAGE_BYTES).then((result) => {
            if (!active) return
            const mimeType = getMarkdownImageMimeType(localPath)
            const tooLarge = result.size !== undefined && result.size > MAX_MARKDOWN_IMAGE_BYTES
            if (!result.success || !result.content || !mimeType || tooLarge) {
                setState({ key: sourceKey, dataUrl: null, failed: true })
                return
            }
            setState({
                key: sourceKey,
                dataUrl: `data:${mimeType};base64,${result.content}`,
                failed: false,
            })
        }).catch(() => {
            if (active) setState({ key: sourceKey, dataUrl: null, failed: true })
        })

        return () => {
            active = false
        }
    }, [api, localPath, sessionId, source.kind, sourceKey, workspacePath])

    if (localPath && state.key === sourceKey && !state.failed && !state.dataUrl) {
        return markdownImageLoading({ label: alt, className })
    }

    if (state.key !== sourceKey || state.failed) {
        return markdownImageFallback({ label: alt, source: typeof src === 'string' ? src : '', className })
    }

    const resolvedSrc = localPath ? state.dataUrl : source.kind === 'remote' ? source.href : null
    if (!resolvedSrc) {
        return markdownImageFallback({ label: alt, source: typeof src === 'string' ? src : '', className })
    }

    return (
        <img
            {...imageProps}
            src={resolvedSrc}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={cn('aui-md-img my-3 max-w-full rounded-xl', className)}
            onError={(event) => {
                onError?.(event)
                setState({ key: sourceKey, dataUrl: null, failed: true })
            }}
        />
    )
}
