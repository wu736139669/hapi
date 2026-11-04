import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { HappyChatProvider, type HappyChatContextValue } from '@/components/AssistantChat/context'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { I18nProvider } from '@/lib/i18n-context'
import { encodeBase64 } from '@/lib/utils'
import { MAX_MARKDOWN_IMAGE_BYTES } from '@/lib/markdown-file-assets'
import { ChatMarkdownImage } from './markdown-image'

function renderMarkdown(content: string, options: {
    workspace?: string
    readSessionFile?: ApiClient['readSessionFile']
    standalone?: boolean
} = {}) {
    const readSessionFile = vi.fn(options.readSessionFile ?? (async () => ({ success: true, content: 'aW1hZ2U=' })))
    const chat: HappyChatContextValue = {
        api: { readSessionFile } as unknown as ApiClient,
        sessionId: 'session-1',
        metadata: { path: options.workspace ?? '/Users/ada/project', host: 'local' },
        terminalToolDisplayMode: 'compact',
        showSessionSummaryInChat: false,
        disabled: false,
        onRefresh: () => {},
        hasMoreMessages: false,
        isSyncingTail: false,
        isLoadingMoreMessages: false,
        loadOlderMessagesPreservingScroll: async () => 'loaded',
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const tree = (text: string) => (
        <I18nProvider>
            <QueryClientProvider client={queryClient}>
                <HappyChatProvider value={chat}>
                    <MarkdownRenderer content={text} standalone={options.standalone} />
                </HappyChatProvider>
            </QueryClientProvider>
        </I18nProvider>
    )
    const view = render(tree(content))
    return { ...view, readSessionFile, queryClient, rerenderMarkdown: (text: string) => view.rerender(tree(text)) }
}

beforeEach(() => {
    localStorage.clear()
})

describe('Markdown message images', () => {
    it.each([false, true])('loads workspace images from the session machine (standalone=%s)', async (standalone) => {
        const { readSessionFile } = renderMarkdown('![Screenshot](/Users/ada/project/output/screen%20one.jpg)', { standalone })

        expect(screen.queryByRole('img')).not.toBeInTheDocument()
        expect(await screen.findByRole('img', { name: 'Screenshot' })).toHaveAttribute('src', 'data:image/jpeg;base64,aW1hZ2U=')
        expect(readSessionFile).toHaveBeenCalledWith('session-1', '/Users/ada/project/output/screen one.jpg')

        fireEvent.click(screen.getByRole('button', { name: /Screenshot/ }))
        expect(screen.getByRole('dialog', { name: 'Screenshot' })).toBeInTheDocument()
    })

    it('loads relative image paths and caches duplicates within the same session', async () => {
        const { readSessionFile } = renderMarkdown('![First](./output/screen.png)\n\n![Second](./output/screen.png)')

        expect(await screen.findAllByRole('img')).toHaveLength(2)
        expect(readSessionFile).toHaveBeenCalledTimes(1)
        expect(readSessionFile).toHaveBeenCalledWith('session-1', './output/screen.png')
    })

    it('preserves Windows paths through Markdown URI encoding', async () => {
        const { readSessionFile } = renderMarkdown('![Screenshot](C:/Users/ada/project/screen%20one.png)', {
            workspace: 'C:\\Users\\ada\\project',
        })

        expect(await screen.findByRole('img', { name: 'Screenshot' })).toHaveAttribute('src', 'data:image/png;base64,aW1hZ2U=')
        expect(readSessionFile).toHaveBeenCalledWith('session-1', 'C:/Users/ada/project/screen one.png')
    })

    it.each([
        '/Users/ada/.local/share/submissions/oauth.jpg',
        '/Users/ada/project/../private.png',
        '/Users/ada/project-other/image.png',
    ])('shows a resend hint for local files outside the workspace: %s', (path) => {
        localStorage.setItem('hapi-lang', 'zh-CN')
        const { container, readSessionFile } = renderMarkdown(`![授权页](${path})`)

        expect(screen.getByRole('status')).toHaveTextContent('授权页')
        expect(screen.getByRole('status')).toHaveTextContent('请让智能体把它作为附件重新发送')
        expect(container.querySelector('img')).toBeNull()
        expect(container.querySelector('[data-image-preview-trigger]')).toBeNull()
        expect(readSessionFile).not.toHaveBeenCalled()
    })

    it('retries a failed session file read', async () => {
        let attempts = 0
        renderMarkdown('![Screenshot](output/screen.png)', {
            readSessionFile: async () => ++attempts === 1
                ? { success: false, error: 'Session offline' }
                : { success: true, content: 'aW1hZ2U=' },
        })

        expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(await screen.findByRole('img', { name: 'Screenshot' })).toBeInTheDocument()
        expect(attempts).toBe(2)
    })

    it('keeps the open image viewer stable while the cached file is revalidated', async () => {
        let finishRead: () => void = () => {}
        const pendingRead = new Promise<void>((resolve) => { finishRead = resolve })
        let attempts = 0
        const { queryClient } = renderMarkdown('![Screenshot](output/screen.png)', {
            readSessionFile: async () => {
                if (++attempts > 1) await pendingRead
                return { success: true, content: 'aW1hZ2U=' }
            },
        })
        fireEvent.click(await screen.findByRole('button', { name: /Screenshot/ }))
        let refresh: Promise<void>
        act(() => { refresh = queryClient.refetchQueries() })
        await waitFor(() => expect(attempts).toBe(2))
        expect(screen.getByRole('dialog', { name: 'Screenshot' })).toBeInTheDocument()
        await act(async () => {
            finishRead()
            await refresh
        })
        expect(screen.getByRole('dialog', { name: 'Screenshot' })).toBeInTheDocument()
    })

    it('keeps remote images direct, replaces load failures with a compact retry, and resets on source changes', async () => {
        const { readSessionFile, rerenderMarkdown } = renderMarkdown('![Remote](https://example.com/first.png)')
        expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/first.png')
        expect(readSessionFile).not.toHaveBeenCalled()

        fireEvent.error(screen.getByRole('img'))
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent('Image could not be loaded.')
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/first.png')

        fireEvent.error(screen.getByRole('img'))
        rerenderMarkdown('![Remote](https://example.com/second.png)')
        await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/second.png'))
    })

    it('does not issue image requests for stripped unsafe URLs', () => {
        const { container, readSessionFile } = renderMarkdown('![Blocked](file:///Users/ada/private.png)')
        expect(container.querySelector('img')).toBeNull()
        expect(screen.getByRole('status')).toHaveTextContent('Blocked')
        expect(readSessionFile).not.toHaveBeenCalled()
    })
})

function chatValue(api: ApiClient, metadataPath: string | null = '/home/ada/coding/hapi'): HappyChatContextValue {
    return {
        api,
        sessionId: 'session-1',
        metadata: metadataPath ? { path: metadataPath, host: 'local' } : null,
        terminalToolDisplayMode: 'compact',
        showSessionSummaryInChat: false,
        disabled: false,
        onRefresh: () => {},
        hasMoreMessages: false,
        isSyncingTail: false,
        isLoadingMoreMessages: false,
        loadOlderMessagesPreservingScroll: async () => 'loaded',
    }
}

function renderImage(props: { src: string; alt: string; api?: ApiClient; metadataPath?: string | null }) {
    const api = props.api ?? ({ readSessionFile: vi.fn() } as unknown as ApiClient)
    return render(
        <I18nProvider>
            <HappyChatProvider value={chatValue(api, props.metadataPath)}>
                <ChatMarkdownImage src={props.src} alt={props.alt} />
            </HappyChatProvider>
        </I18nProvider>
    )
}

describe('ChatMarkdownImage', () => {
    it('loads a relative workspace image through the authenticated session API', async () => {
        const readSessionFile = vi.fn(async () => ({
            success: true,
            content: encodeBase64('png-bytes'),
            size: 9,
        }))
        const api = { readSessionFile } as unknown as ApiClient

        renderImage({ src: 'images/chart.png', alt: 'Chart', api })

        await waitFor(() => expect(screen.getByRole('img', { name: 'Chart', hidden: false }).tagName).toBe('IMG'))
        expect(screen.getByRole('img', { name: 'Chart' })).toHaveAttribute('src', 'data:image/png;base64,cG5nLWJ5dGVz')
        expect(readSessionFile).toHaveBeenCalledWith('session-1', 'images/chart.png', MAX_MARKDOWN_IMAGE_BYTES)
    })

    it('renders a relative workspace image through the conversation Markdown renderer', async () => {
        const readSessionFile = vi.fn(async () => ({
            success: true,
            content: encodeBase64('png-bytes'),
            size: 9,
        }))
        const api = { readSessionFile } as unknown as ApiClient
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

        render(
            <QueryClientProvider client={queryClient}>
                <I18nProvider>
                    <HappyChatProvider value={chatValue(api)}>
                        <MarkdownRenderer content={'![Chart](images/chart.png)'} />
                    </HappyChatProvider>
                </I18nProvider>
            </QueryClientProvider>
        )

        await waitFor(() => expect(screen.getByRole('img', { name: 'Chart' }).tagName).toBe('IMG'))
        expect(readSessionFile).toHaveBeenCalledWith('session-1', 'images/chart.png')
    })

    it('loads reachable HTTPS images directly without reading a session file', () => {
        const readSessionFile = vi.fn()
        const api = { readSessionFile } as unknown as ApiClient

        renderImage({ src: 'https://example.com/chart.png', alt: 'Remote chart', api })

        expect(screen.getByRole('img', { name: 'Remote chart' })).toHaveAttribute('src', 'https://example.com/chart.png')
        expect(readSessionFile).not.toHaveBeenCalled()
    })

    it('shows a fallback when a remote image fails to load', async () => {
        renderImage({ src: 'https://example.com/missing.png', alt: 'Missing remote' })

        const image = screen.getByRole('img', { name: 'Missing remote' })
        fireEvent.error(image)

        await waitFor(() => expect(screen.getByRole('img', { name: 'Missing remote' })).toHaveAttribute('data-hapi-markdown-image-fallback', 'true'))
    })

    it.each([
        ['../outside.png', 'parent traversal'],
        ['/etc/secret.png', 'outside absolute path'],
        ['data:image/png;base64,ZmFrZQ==', 'data URI'],
        ['file:///tmp/secret.png', 'file URI'],
    ])('does not read %s (%s)', (src) => {
        const readSessionFile = vi.fn()
        const api = { readSessionFile } as unknown as ApiClient

        renderImage({ src, alt: 'Blocked image', api })

        expect(screen.getByRole('img', { name: 'Blocked image' })).toHaveAttribute('data-hapi-markdown-image-fallback', 'true')
        expect(readSessionFile).not.toHaveBeenCalled()
    })

    it('keeps an in-workspace absolute path behind the session file API', async () => {
        const readSessionFile = vi.fn(async () => ({
            success: true,
            content: encodeBase64('png-bytes'),
            size: 9,
        }))
        const api = { readSessionFile } as unknown as ApiClient

        renderImage({ src: '/home/ada/coding/hapi/images/chart.png', alt: 'Absolute chart', api })

        await waitFor(() => expect(screen.getByRole('img', { name: 'Absolute chart' }).tagName).toBe('IMG'))
        expect(readSessionFile).toHaveBeenCalledWith('session-1', '/home/ada/coding/hapi/images/chart.png', MAX_MARKDOWN_IMAGE_BYTES)
    })
})
