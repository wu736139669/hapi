import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { isObject } from '@hapi/protocol'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'
import { useTranslation } from '@/lib/use-translation'
import { EXECUTION_PROCESS_TOGGLE_EVENT, type ExecutionProcessToggleDetail } from './executionProcessEvents'

const NON_EXECUTION_PROCESS_TOOL_NAMES = new Set(['GeneratedImage', 'CodexPermission'])
const EXECUTION_PROCESS_HEIGHT = '11rem'
const EXECUTION_PROCESS_EXPANDED_HEIGHT = '22rem'
const EXECUTION_PROCESS_MAX_HEIGHT = 'calc(var(--tg-viewport-stable-height, var(--app-viewport-height, 100dvh)) - 9rem)'
type MessagePartForExecutionProcess = {
    readonly type: string
    readonly toolName?: string
    readonly artifact?: unknown
}

export type ExecutionProcessGroupKey = 'group-execution-process' | 'group-reasoning'

const EXECUTION_PROCESS_GROUP = ['group-execution-process'] as const
const REASONING_GROUP = ['group-execution-process', 'group-reasoning'] as const

function hasPendingPermission(artifact: unknown): boolean {
    return isObject(artifact)
        && artifact.kind === 'tool-call'
        && isObject(artifact.tool)
        && isObject(artifact.tool.permission)
        && artifact.tool.permission.status === 'pending'
}

function isExecutionProcessToolPart(part: MessagePartForExecutionProcess): boolean {
    if (part.type !== 'tool-call' || typeof part.toolName !== 'string') return false
    if (NON_EXECUTION_PROCESS_TOOL_NAMES.has(part.toolName)) return false
    if (isAskUserQuestionToolName(part.toolName) || isRequestUserInputToolName(part.toolName)) return false
    if (hasPendingPermission(part.artifact)) return false
    return true
}

export function shouldRenderExecutionProcessPanel(parts: readonly MessagePartForExecutionProcess[]): boolean {
    return parts.some((part) => part.type === 'reasoning' || isExecutionProcessToolPart(part))
}

export function getExecutionProcessGroupPaths(
    parts: readonly MessagePartForExecutionProcess[]
): readonly (readonly ExecutionProcessGroupKey[])[] {
    if (!shouldRenderExecutionProcessPanel(parts)) return parts.map(() => [])

    const finalTextIndex = parts.at(-1)?.type === 'text' ? parts.length - 1 : -1
    return parts.map((part, partIndex) => {
        if (part.type === 'reasoning') return REASONING_GROUP
        if (isExecutionProcessToolPart(part)) return EXECUTION_PROCESS_GROUP
        if (part.type === 'text' && partIndex !== finalTextIndex) return EXECUTION_PROCESS_GROUP
        return []
    })
}

function ExecutionProcessExpandIcon(props: { expanded: boolean }) {
    return (
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
            className={`transition-transform duration-200 ${props.expanded ? 'rotate-180' : ''}`}
        >
            <path d="m7 10 5 5 5-5" />
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
    const nextExpanded = !expanded
    const handleToggle = () => {
        window.dispatchEvent(new CustomEvent<ExecutionProcessToggleDetail>(EXECUTION_PROCESS_TOGGLE_EVENT, {
            detail: { expanded: nextExpanded }
        }))
        setExpanded(nextExpanded)
    }

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
            className="hapi-execution-process flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[20px]"
            style={{
                height: expanded ? EXECUTION_PROCESS_EXPANDED_HEIGHT : EXECUTION_PROCESS_HEIGHT,
                maxHeight: EXECUTION_PROCESS_MAX_HEIGHT
            }}
            aria-label={title}
        >
            <header className="hapi-execution-process__header flex h-11 shrink-0 items-center justify-between gap-3 px-3">
                <h2 className="min-w-0 truncate text-sm font-semibold tracking-wide text-[var(--app-fg)]">
                    {title}
                </h2>
                <button
                    type="button"
                    aria-label={expandLabel}
                    title={expandLabel}
                    aria-expanded={expanded}
                    aria-pressed={expanded}
                    className={`hapi-execution-process__expand flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] ${
                        expanded
                            ? 'bg-[var(--app-bg)]'
                            : 'text-[var(--app-fg)]/60 hover:text-[var(--app-fg)]'
                    }`}
                    onClick={handleToggle}
                >
                    <ExecutionProcessExpandIcon expanded={expanded} />
                </button>
            </header>
            <div
                ref={scrollSurfaceRef}
                data-hapi-nested-scroll="true"
                className="hapi-execution-process__body app-scroll-y min-h-0 flex-1 overflow-y-auto px-2 py-2"
                onScroll={handleScroll}
            >
                {props.children}
            </div>
        </section>
    )
}
