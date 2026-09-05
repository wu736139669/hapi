import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import {
    ExecutionProcessPanel,
    getExecutionProcessGroupPaths,
    shouldRenderExecutionProcessPanel
} from './ExecutionProcessPanel'

function renderPanel() {
    return render(
        <I18nProvider>
            <ExecutionProcessPanel>
                <div>Terminal</div>
                <div>Details</div>
            </ExecutionProcessPanel>
        </I18nProvider>
    )
}

describe('ExecutionProcessPanel', () => {
    afterEach(() => {
        cleanup()
        localStorage.clear()
    })

    it('opens for a single reasoning or non-interactive tool module', () => {
        expect(shouldRenderExecutionProcessPanel([
            { type: 'tool-call', toolName: 'Bash' }
        ])).toBe(true)
        expect(getExecutionProcessGroupPaths([
            { type: 'tool-call', toolName: 'Bash' }
        ])).toEqual([['group-execution-process']])
        expect(shouldRenderExecutionProcessPanel([
            { type: 'reasoning' }
        ])).toBe(true)
        expect(shouldRenderExecutionProcessPanel([
            { type: 'tool-call', toolName: 'Bash' },
            { type: 'tool-call', toolName: 'Read' }
        ])).toBe(true)
        expect(shouldRenderExecutionProcessPanel([
            { type: 'tool-call', toolName: 'Bash' },
            { type: 'tool-call', toolName: 'Read' },
            { type: 'text' }
        ])).toBe(true)
        expect(shouldRenderExecutionProcessPanel([
            { type: 'tool-call', toolName: 'request_user_input' }
        ])).toBe(false)
        expect(shouldRenderExecutionProcessPanel([
            { type: 'tool-call', toolName: 'GeneratedImage' }
        ])).toBe(false)
        expect(shouldRenderExecutionProcessPanel([
            {
                type: 'tool-call',
                toolName: 'Bash',
                artifact: {
                    kind: 'tool-call',
                    tool: { permission: { status: 'pending' } }
                }
            }
        ])).toBe(false)
    })

    it('groups reasoning, tools, and intermediate text while leaving the final text outside', () => {
        const parts = [
            { type: 'text' },
            { type: 'reasoning' },
            { type: 'tool-call', toolName: 'Bash' },
            { type: 'text' }
        ]

        expect(getExecutionProcessGroupPaths(parts)).toEqual([
            ['group-execution-process'],
            ['group-execution-process', 'group-reasoning'],
            ['group-execution-process'],
            []
        ])
    })

    it('leaves pure final text and interactive tools outside the execution process', () => {
        expect(getExecutionProcessGroupPaths([{ type: 'text' }])).toEqual([[]])

        const interactiveParts = [
            { type: 'text' },
            { type: 'tool-call', toolName: 'AskUserQuestion' }
        ]
        expect(getExecutionProcessGroupPaths(interactiveParts)).toEqual([[], []])
    })

    it('keeps process modules in a fixed-height nested scroll surface', () => {
        const view = renderPanel()
        const panel = view.container.querySelector<HTMLElement>('[data-hapi-execution-process]')
        const scrollSurface = view.container.querySelector('[data-hapi-nested-scroll="true"]')

        expect(screen.getByRole('heading', { name: 'Execution process' })).toBeInTheDocument()
        expect(panel).toHaveAttribute('data-expanded', 'false')
        expect(panel).toHaveStyle({ height: '22rem' })
        expect(panel?.style.maxHeight).toBe('calc(var(--tg-viewport-stable-height, var(--app-viewport-height, 100dvh)) - 9rem)')
        expect(scrollSurface).toHaveClass('overflow-y-auto')
        expect(screen.getByText('Terminal')).toBeInTheDocument()
    })

    it('doubles the process window height from the header button', () => {
        const view = renderPanel()
        const panel = view.container.querySelector('[data-hapi-execution-process]')
        const button = screen.getByRole('button', { name: 'Expand execution process' })

        fireEvent.click(button)

        expect(panel).toHaveAttribute('data-expanded', 'true')
        expect(panel).toHaveStyle({ height: '44rem' })
        expect(screen.getByRole('button', { name: 'Collapse execution process' })).toHaveAttribute('aria-expanded', 'true')
    })

    it('follows newly appended process modules while the inner view is at the bottom', () => {
        const view = renderPanel()
        const scrollSurface = view.container.querySelector<HTMLElement>('[data-hapi-nested-scroll="true"]')
        if (!scrollSurface) throw new Error('Process scroll surface was not rendered')

        let scrollHeight = 900
        let scrollTop = 548
        Object.defineProperties(scrollSurface, {
            scrollHeight: { configurable: true, get: () => scrollHeight },
            clientHeight: { configurable: true, get: () => 352 },
            scrollTop: {
                configurable: true,
                get: () => scrollTop,
                set: (value: number) => {
                    scrollTop = Math.min(Math.max(value, 0), Math.max(0, scrollHeight - 352))
                }
            }
        })
        fireEvent.scroll(scrollSurface)
        scrollHeight = 1_200

        view.rerender(
            <I18nProvider>
                <ExecutionProcessPanel>
                    <div>Terminal</div>
                    <div>Details</div>
                    <div>New process module</div>
                </ExecutionProcessPanel>
            </I18nProvider>
        )

        expect(scrollSurface.scrollTop).toBe(848)
    })
})
