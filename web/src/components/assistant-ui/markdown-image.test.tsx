import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { HappyChatProvider, type HappyChatContextValue } from '@/components/AssistantChat/context'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { I18nProvider } from '@/lib/i18n-context'

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
