import { MessagePrimitive, useAuiState } from '@assistant-ui/react'
import { useEffect, useState } from 'react'
import { getEventPresentation } from '@/chat/presentation'
import type { AgentEvent } from '@/chat/types'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { getConversationMessageAnchorId } from '@/chat/outline'
import { MessageTimestamp } from '@/components/AssistantChat/messages/MessageTimestamp'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { useHappyChatContext } from '@/components/AssistantChat/context'

function formatTokenDelta(event: AgentEvent | undefined): string | null {
    if (!event || event.type !== 'compact-summary') return null
    const parts: string[] = []
    if (typeof event.tokensBefore === 'number') parts.push(event.tokensBefore.toLocaleString())
    if (typeof event.estimatedTokensAfter === 'number') parts.push(event.estimatedTokensAfter.toLocaleString())
    if (parts.length === 0) return null
    return parts.length === 2 ? `${parts[0]} → ${parts[1]} tokens` : `${parts[0]} tokens`
}

export function HappySystemMessage() {
    const ctx = useHappyChatContext()
    const [retrying, setRetrying] = useState(false)
    const [retrySeconds, setRetrySeconds] = useState<number | null>(null)
    const role = useAuiState((s) => s.message.role)
    const messageId = useAuiState((s) => s.message.id)
    const text = useAuiState((s) => {
        if (s.message.role !== 'system') return ''
        return s.message.content[0]?.type === 'text' ? s.message.content[0].text : ''
    })
    const icon = useAuiState((s) => {
        if (s.message.role !== 'system') return null
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        const event = custom?.kind === 'event' ? custom.event : undefined
        return event ? getEventPresentation(event).icon : null
    })
    const compactSummary = useAuiState((s) => {
        if (s.message.role !== 'system') return undefined
        const custom = s.message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'compact-summary' ? custom.event : undefined
    })

    if (role !== 'system') return null

    const canRetryCapacity = text.includes('Selected model is at capacity') && Boolean(ctx.onRetryCodexTurn)
    const retryDelayMatch = text.match(/retrying same conversation in (\d+) seconds?/i)
    const parsedRetrySeconds = retryDelayMatch ? Number(retryDelayMatch[1]) : null

    useEffect(() => {
        if (!canRetryCapacity || parsedRetrySeconds === null) {
            setRetrySeconds(null)
            return
        }
        setRetrySeconds(parsedRetrySeconds)
        const timer = window.setInterval(() => {
            setRetrySeconds((seconds) => seconds === null ? null : Math.max(0, seconds - 1))
        }, 1000)
        return () => window.clearInterval(timer)
    }, [canRetryCapacity, parsedRetrySeconds])

    // Pi compaction summaries are real content, not status: render them as an
    // independent block (header with token delta + the summary markdown)
    // instead of the tiny centered status line used for other events.
    if (compactSummary && compactSummary.type === 'compact-summary') {
        const delta = formatTokenDelta(compactSummary)
        return (
            <MessagePrimitive.Root id={getConversationMessageAnchorId(messageId)} className="scroll-mt-4 py-1">
                <div className="mx-auto max-w-[92%] rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--app-hint)]">
                        <span aria-hidden="true">📦</span>
                        <span className="font-medium">Context compacted</span>
                        {delta ? <span className="font-normal">{delta}</span> : null}
                        <MessageTimestamp className="text-[10px]" />
                    </div>
                    {text ? (
                        <div className="max-h-96 overflow-y-auto pr-1">
                            <MarkdownRenderer standalone content={text} />
                        </div>
                    ) : null}
                </div>
            </MessagePrimitive.Root>
        )
    }

    return (
        <MessagePrimitive.Root id={getConversationMessageAnchorId(messageId)} className="scroll-mt-4 py-1">
            <div className="mx-auto flex w-full max-w-[92%] items-center justify-between gap-4 rounded-[24px] border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-4 py-3 text-sm text-[var(--app-fg)] shadow-sm">
                <span className="inline-flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--app-secondary-bg)] text-[var(--app-fg)]" aria-hidden="true">!</span>
                    <span className="truncate">{text.replace(/; retrying same conversation.*$/i, '')}</span>
                </span>
                {canRetryCapacity ? (
                    <button
                        type="button"
                        disabled={retrying}
                        className="shrink-0 rounded-full bg-[var(--app-secondary-bg)] px-4 py-1.5 text-sm text-[var(--app-fg)] transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-50"
                        onClick={async () => {
                            if (!ctx.onRetryCodexTurn || retrying) return
                            setRetrying(true)
                            try {
                                await ctx.onRetryCodexTurn()
                            } finally {
                                setRetrying(false)
                            }
                        }}
                    >
                        {retrying ? 'Retrying…' : retrySeconds !== null && retrySeconds > 0 ? `${retrySeconds} 秒后重试` : '重试'}
                    </button>
                ) : <MessageTimestamp className="text-[10px]" />}
            </div>
        </MessagePrimitive.Root>
    )
}
