import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon, CloseIcon, CopyIcon } from '@/components/icons'
import { LoadingState } from '@/components/LoadingState'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { useAppContext } from '@/lib/app-context'
import { decodeBase64 } from '@/lib/utils'
import { downloadBase64File } from '@/lib/file-download'
import { queryKeys } from '@/lib/query-keys'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTranslation } from '@/lib/use-translation'
import {
    isHtmlFile,
    isMarkdownFile,
    prepareHtmlDocument,
    resolveImageMimeType,
} from '@/lib/file-preview'
import {
    FilePreviewContextProvider,
    type FilePreviewRequest,
} from '@/lib/file-preview-context'

function OpenInNewTabIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
    )
}

function DownloadIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    )
}

function openInteractiveHtml(content: string, title: string): void {
    const previewWindow = window.open('about:blank', '_blank')
    if (!previewWindow) return

    try {
        previewWindow.opener = null
        const document = previewWindow.document
        document.open()
        document.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;background:#f7f7f5;color:#252525;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{display:flex;align-items:center;gap:10px;flex:0 0 44px;padding:0 14px;background:#f1f1ed;box-shadow:0 1px 8px rgba(0,0,0,.08)}header span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#777}iframe{display:block;flex:1;min-height:0;width:100%;border:0;background:#fff}</style></head><body></body></html>')
        document.close()
        document.title = title

        const header = document.createElement('header')
        const label = document.createElement('span')
        label.textContent = title
        header.appendChild(label)
        document.body.appendChild(header)

        const frame = document.createElement('iframe')
        frame.setAttribute('sandbox', 'allow-scripts allow-forms')
        frame.setAttribute('referrerpolicy', 'no-referrer')
        frame.srcdoc = prepareHtmlDocument(content)
        document.body.appendChild(frame)
    } catch {
        previewWindow.close()
    }
}

function FilePreviewModal(props: { request: FilePreviewRequest; onClose: () => void }) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { copied, copy } = useCopyToClipboard()
    const [mode, setMode] = useState<'preview' | 'source'>('preview')

    const fileQuery = useQuery({
        queryKey: queryKeys.sessionFile(props.request.sessionId, props.request.filePath),
        queryFn: () => api.readSessionFile(props.request.sessionId, props.request.filePath),
    })

    const fileName = props.request.filePath.split('/').pop() || props.request.filePath
    const imageMimeType = useMemo(() => resolveImageMimeType(props.request.filePath), [props.request.filePath])
    const markdownFile = useMemo(() => isMarkdownFile(props.request.filePath), [props.request.filePath])
    const htmlFile = useMemo(() => isHtmlFile(props.request.filePath), [props.request.filePath])
    const decoded = fileQuery.data?.success && fileQuery.data.content
        ? decodeBase64(fileQuery.data.content)
        : { ok: true, text: '' }
    const imageUrl = fileQuery.data?.success && fileQuery.data.content && imageMimeType
        ? `data:${imageMimeType};base64,${fileQuery.data.content}`
        : null
    const previewable = Boolean(imageMimeType || markdownFile || htmlFile)

    useEffect(() => {
        setMode('preview')
    }, [props.request.filePath])

    useEffect(() => {
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') props.onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
            document.body.style.overflow = previousOverflow
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [props.onClose])

    const handleBackdropClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) props.onClose()
    }, [props.onClose])

    const openExternal = () => {
        if (htmlFile && decoded.text) openInteractiveHtml(decoded.text, fileName)
    }

    return (
        <div
            role="presentation"
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-0 backdrop-blur-[2px] sm:p-5"
            onMouseDown={handleBackdropClick}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="hapi-file-preview-title"
                className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--app-bg)] shadow-2xl sm:h-[min(92dvh,900px)] sm:max-w-6xl sm:rounded-2xl"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="flex shrink-0 items-center gap-3 border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2.5 sm:px-4">
                    <div className="min-w-0 flex-1">
                        <div id="hapi-file-preview-title" className="truncate text-sm font-semibold text-[var(--app-fg)]">{fileName}</div>
                        <div className="truncate text-[11px] text-[var(--app-hint)]">{props.request.filePath}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {htmlFile ? (
                            <button type="button" onClick={openExternal} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]" title={t('file.page.htmlPreviewOpenInNewTab')}>
                                <OpenInNewTabIcon />
                                <span className="hidden sm:inline">{t('file.page.htmlPreviewOpenInNewTab')}</span>
                            </button>
                        ) : null}
                        {fileQuery.data?.success && fileQuery.data.content ? (
                            <button type="button" onClick={() => downloadBase64File(fileName, fileQuery.data!.content!, imageMimeType)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]" title={t('file.page.download')}>
                                <DownloadIcon />
                                <span className="hidden sm:inline">{t('file.page.download')}</span>
                            </button>
                        ) : null}
                        <button type="button" onClick={props.onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]" title={t('button.close')} aria-label={t('button.close')} autoFocus>
                            <CloseIcon className="h-4 w-4" />
                        </button>
                    </div>
                </header>

                {previewable && !imageMimeType ? (
                    <div className="flex shrink-0 items-center gap-1 border-b border-[var(--app-divider)] bg-[var(--app-subtle-bg)] px-3 py-1.5 sm:px-4">
                        <button type="button" onClick={() => setMode('preview')} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${mode === 'preview' ? 'bg-[var(--app-button)] text-[var(--app-button-text)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-bg)]'}`}>{t('file.page.tab.preview')}</button>
                        <button type="button" onClick={() => setMode('source')} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${mode === 'source' ? 'bg-[var(--app-button)] text-[var(--app-button-text)]' : 'text-[var(--app-hint)] hover:bg-[var(--app-bg)]'}`}>{t('file.page.tab.source')}</button>
                    </div>
                ) : null}

                <div className="app-scroll-y min-h-0 flex-1 bg-[var(--app-bg)] p-3 sm:p-5">
                    {fileQuery.isLoading ? (
                        <div className="flex h-full items-center justify-center"><LoadingState label={t('loading.file')} className="text-sm" /></div>
                    ) : fileQuery.error || !fileQuery.data?.success ? (
                        <div className="rounded-lg bg-amber-500/10 p-3 text-sm text-[var(--app-hint)]">{fileQuery.error instanceof Error ? fileQuery.error.message : fileQuery.data?.error ?? t('file.page.empty')}</div>
                    ) : imageUrl ? (
                        <div className="flex min-h-full items-center justify-center rounded-xl bg-[var(--app-subtle-bg)] p-3 sm:p-6">
                            <img src={imageUrl} alt={t('file.page.imagePreviewAlt', { name: fileName })} className="max-h-[calc(100dvh-150px)] max-w-full object-contain" />
                        </div>
                    ) : mode === 'preview' && markdownFile ? (
                        <div className="markdown-content mx-auto max-w-4xl">
                            <MarkdownRenderer content={decoded.text} standalone />
                        </div>
                    ) : mode === 'preview' && htmlFile ? (
                        <div className="mx-auto h-full min-h-[420px] max-w-5xl overflow-hidden rounded-xl bg-white shadow-sm">
                            <iframe title={t('file.page.htmlPreviewTitle', { name: fileName })} srcDoc={prepareHtmlDocument(decoded.text)} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" className="block h-full min-h-[420px] w-full border-0 bg-white" />
                        </div>
                    ) : (
                        <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-xl bg-[var(--app-code-bg)]">
                            <div className="flex shrink-0 items-center justify-end border-b border-[var(--app-divider)] px-3 py-1.5">
                                <button type="button" onClick={() => copy(decoded.text)} className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]" title={t('file.page.copyContent')}>
                                    {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                                    {t('file.page.copyContent')}
                                </button>
                            </div>
                            <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs font-mono text-[var(--app-fg)]"><code>{decoded.text}</code></pre>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export function FilePreviewHost(props: { children: ReactNode }) {
    const [request, setRequest] = useState<FilePreviewRequest | null>(null)
    const openFilePreview = useCallback((next: FilePreviewRequest) => setRequest(next), [])
    const close = useCallback(() => setRequest(null), [])

    return (
        <FilePreviewContextProvider value={{ openFilePreview }}>
            {props.children}
            {request ? <FilePreviewModal request={request} onClose={close} /> : null}
        </FilePreviewContextProvider>
    )
}
