import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import { formatFileMetadata } from '@/lib/file-metadata'
import { encodeBase64 } from '@/lib/utils'
import FilePage from './file'

const goBackMock = vi.fn()
const copyMock = vi.hoisted(() => vi.fn())

const sampleMarkdown = '# Heading\n\n| Col A | Col B |\n| --- | --- |\n| one | two |'
const filePath = 'docs/README.md'
const encodedPath = encodeBase64(filePath)
const encodedContent = encodeBase64(sampleMarkdown)
const htmlPath = 'public/index.html'
const sampleHtml = '<!doctype html><html><body><h1>Hello HAPI</h1></body></html>'
const encodedHtml = encodeBase64(sampleHtml)
const fileSize = 1024
const fileModified = 1_784_175_060_000
let activePath = encodedPath
let activeContent = encodedContent
let activeDiff: { success: boolean; stdout?: string; error?: string } = { success: true, stdout: '' }

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ sessionId: 'session-1' }),
    useSearch: () => ({
        path: activePath,
        staged: undefined,
    }),
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: {
            getGitDiffFile: vi.fn(async () => activeDiff),
            readSessionFile: vi.fn(async () => ({
                success: true,
                content: activeContent,
                size: fileSize,
                modified: fileModified,
            })),
        },
    }),
}))

vi.mock('@/hooks/useAppGoBack', () => ({
    useAppGoBack: () => goBackMock,
}))

vi.mock('@/hooks/useCopyToClipboard', () => ({
    useCopyToClipboard: () => ({
        copied: false,
        copy: copyMock,
    }),
}))

vi.mock('@/lib/shiki', () => ({
    langAlias: { md: 'markdown' },
    useShikiHighlighter: (content: string) => content,
}))

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownRenderer: (props: { content: string }) => (
        <div data-testid="markdown-preview">{props.content}</div>
    ),
}))

function renderWithProviders() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <FilePage />
            </I18nProvider>
        </QueryClientProvider>
    )
}

describe('FilePage markdown preview', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        window.localStorage.clear()
        window.sessionStorage.clear()
        activePath = encodedPath
        activeContent = encodedContent
        activeDiff = { success: true, stdout: '' }
    })

    it('renders markdown preview by default and toggles to source', async () => {
        renderWithProviders()

        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toHaveTextContent('# Heading')
        })
        expect(screen.getByText(formatFileMetadata(fileSize, fileModified, 'en')!)).toBeInTheDocument()
        expect(screen.getAllByText(filePath)).toHaveLength(1)
        const previewCopyButton = screen.getByRole('button', { name: 'Copy file content' })
        expect(previewCopyButton.closest('[data-hapi-file-content-header="true"]')).not.toBeNull()
        expect(previewCopyButton).not.toHaveClass('absolute')
        fireEvent.click(previewCopyButton)
        expect(copyMock).toHaveBeenCalledWith(sampleMarkdown)
        expect(screen.getByRole('button', { name: 'Preview' })).toHaveClass('opacity-80')

        fireEvent.click(screen.getByRole('button', { name: 'Source' }))

        await waitFor(() => {
            expect(screen.getByRole('code')).toHaveTextContent('# Heading')
        })
        const sourcePreview = screen.getByRole('code').closest('[data-hapi-file-source-preview="true"]')
        const sourceCopyButton = screen.getByRole('button', { name: 'Copy file content' })
        expect(sourcePreview).not.toBeNull()
        expect(sourcePreview).toContainElement(sourceCopyButton)
        expect(sourceCopyButton.closest('[data-hapi-file-content-header="true"]')).not.toBeNull()
        expect(sourceCopyButton).not.toHaveClass('absolute')
        expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
    })

    it('preserves the file preview scroll position across route remounts', async () => {
        const firstRender = renderWithProviders()

        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
        const firstScrollRegion = document.querySelector('[data-hapi-file-scroll="true"]') as HTMLElement
        expect(firstScrollRegion).not.toBeNull()
        firstScrollRegion.scrollTop = 123
        firstRender.unmount()

        renderWithProviders()
        await waitFor(() => {
            expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
        })
        const secondScrollRegion = document.querySelector('[data-hapi-file-scroll="true"]') as HTMLElement
        expect(secondScrollRegion.scrollTop).toBe(123)
    })

    it('renders HTML files in a sandboxed preview and allows switching to source', async () => {
        activePath = encodeBase64(htmlPath)
        activeContent = encodedHtml
        renderWithProviders()

        const iframe = await screen.findByTitle('HTML preview for index.html')
        expect(iframe).toHaveAttribute('sandbox', '')
        expect(iframe.getAttribute('srcdoc')).toContain('<h1>Hello HAPI</h1>')
        expect(iframe.getAttribute('srcdoc')).toContain(
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
        )
        expect(screen.getByText('Preview sandbox · scripts disabled')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Source' }))
        expect(screen.getByRole('code')).toHaveTextContent(sampleHtml)
        expect(screen.queryByTitle('HTML preview for index.html')).not.toBeInTheDocument()
    })

    it('does not show a Git diff error above an HTML preview', async () => {
        activePath = encodeBase64(htmlPath)
        activeContent = encodedHtml
        activeDiff = {
            success: false,
            error: 'Command failed: git diff --no-ext-diff -- path\nwarning: Not a git repository.\nUse --no-index to compare two paths outside a working tree.'
        }
        renderWithProviders()

        expect(await screen.findByTitle('HTML preview for index.html')).toBeInTheDocument()
        expect(screen.queryByText(/Diff 不可用/)).not.toBeInTheDocument()
        expect(screen.queryByText(/Not a git repository/)).not.toBeInTheDocument()
    })

    it('opens an interactive HTML copy in a new tab with responsive viewport metadata', async () => {
        activePath = encodeBase64(htmlPath)
        activeContent = encodedHtml
        const openMock = vi.spyOn(window, 'open').mockImplementation(() => null)
        renderWithProviders()

        await screen.findByTitle('HTML preview for index.html')
        fireEvent.click(screen.getByRole('button', { name: 'Open in new tab' }))

        expect(openMock).toHaveBeenCalledWith(
            expect.stringContaining('data:text/html;charset=utf-8,'),
            '_blank',
            'noopener,noreferrer'
        )
        const url = openMock.mock.calls[0]?.[0]
        expect(typeof url).toBe('string')
        expect(decodeURIComponent(String(url).split(',').slice(1).join(','))).toContain(
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
        )
        openMock.mockRestore()
    })
})
