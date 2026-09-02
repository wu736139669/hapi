import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'
import { useTranslation } from '@/lib/use-translation'

const NON_EXECUTION_PROCESS_TOOL_NAMES = new Set(['GeneratedImage', 'CodexPermission'])

type MessagePartForExecutionProcess = {
    readonly type: string
    readonly toolName?: string
}

export function shouldRenderExecutionProcessPanel(parts: readonly MessagePartForExecutionProcess[]): boolean {
    if (parts.length < 2) return false

    return parts.every((part) => {
        if (part.type !== 'tool-call' || typeof part.toolName !== 'string') return false
        if (NON_EXECUTION_PROCESS_TOOL_NAMES.has(part.toolName)) return false
        if (isAskUserQuestionToolName(part.toolName) || isRequestUserInputToolName(part.toolName)) return false
        return true
    })
}

function ExecutionProcessExpandIcon(props: { expanded: boolean }) {
    return props.expanded ? (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M8 3v5H3" />
            <path d="m3 3 5 5" />
            <path d="M16 3v5h5" />
            <path d="m21 3-5 5" />
            <path d="M8 21v-5H3" />
            <path d="m3 21 5-5" />
            <path d="M16 21v-5h5" />
            <path d="m21 21-5-5" />
        </svg>
    ) : (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M8 3H3v5" />
            <path d="m3 3 5 5" />
            <path d="M16 3h5v5" />
            <path d="m21 3-5 5" />
            <path d="M8 21H3v-5" />
            <path d="m3 21 5-5" />
            <path d="M16 21h5v-5" />
            <path d="m21 21-5-5" />
        </svg>
    )
}

export function ExecutionProcessPanel(props: { children: ReactNode }) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    const [followLatest, setFollowLatest] = useState(true)
    const scrollSurfaceRef = useRef<HTMLDivElement | null>(null)
    const title = t('toolGroup.executionProcess.title')
    const expandLabel = expanded
        ? t('toolGroup.executionProcess.collapse')
        : t('toolGroup.executionProcess.expand')

    useLayoutEffect(() => {
        const scrollSurface = scrollSurfaceRef.current
        if (!scrollSurface || !followLatest) return
        scrollSurface.scrollTop = scrollSurface.scrollHeight
    }, [props.children, expanded, followLatest])

    const handleScroll = () => {
        const scrollSurface = scrollSurfaceRef.current
        if (!scrollSurface) return
        const distanceFromBottom = scrollSurface.scrollHeight - scrollSurface.scrollTop - scrollSurface.clientHeight
        setFollowLatest(distanceFromBottom <= 24)
    }

    return (
        <section
            data-hapi-execution-process="true"
            data-expanded={expanded ? 'true' : 'false'}
            className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[20px] border border-[var(--app-border)] bg-[var(--app-tool-group-bg)] shadow-none"
            style={{
                height: expanded ? '44rem' : '22rem',
                maxHeight: 'calc(100vh - 9rem)'
            }}
            aria-label={title}
        >
            <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--app-border)] px-3">
                <h2 className="min-w-0 truncate text-sm font-semibold text-[var(--app-fg)]">
                    {title}
                </h2>
                <button
                    type="button"
                    aria-label={expandLabel}
                    title={expandLabel}
                    aria-expanded={expanded}
                    aria-pressed={expanded}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] ${
                        expanded
                            ? 'bg-[var(--app-bg)] text-[var(--app-link)]'
                            : 'text-[var(--app-fg)]/60 hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)]'
                    }`}
                    onClick={() => setExpanded((value) => !value)}
                >
                    <ExecutionProcessExpandIcon expanded={expanded} />
                </button>
            </header>
            <div
                ref={scrollSurfaceRef}
                data-hapi-nested-scroll="true"
                className="app-scroll-y min-h-0 flex-1 overflow-y-auto px-2 py-2"
                onScroll={handleScroll}
            >
                {props.children}
            </div>
        </section>
    )
}
