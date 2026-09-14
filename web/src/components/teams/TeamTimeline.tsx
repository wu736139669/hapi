import { useMemo, useState } from 'react'
import type { TeamMember, TeamMessage } from '@/types/team'
import { useTranslation } from '@/lib/use-translation'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { statusDotClass } from './teamStatus'

const THREAD_MIN_MESSAGES = 3

type TimelineItem =
    | { type: 'message'; message: TeamMessage }
    | { type: 'thread'; key: string; messages: TeamMessage[] }

function isFoldablePeerMessage(message: TeamMessage): boolean {
    return message.fromKind === 'session'
        && message.toSessionId !== null
        && (message.kind === 'chat' || message.kind === 'status' || message.kind === 'question')
}

export function buildTimelineItems(messages: TeamMessage[], foldThreads: boolean): TimelineItem[] {
    const items: TimelineItem[] = []
    let run: TeamMessage[] = []
    const flush = () => {
        if (run.length === 0) return
        if (foldThreads && run.length >= THREAD_MIN_MESSAGES) {
            items.push({ type: 'thread', key: `thread-${run[0]!.seq}`, messages: run })
        } else {
            for (const message of run) {
                items.push({ type: 'message', message })
            }
        }
        run = []
    }
    for (const message of messages) {
        if (isFoldablePeerMessage(message)) {
            run.push(message)
            continue
        }
        flush()
        items.push({ type: 'message', message })
    }
    flush()
    return items
}

function formatTime(value: number): string {
    const date = new Date(value)
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
}

function roleOf(members: TeamMember[], sessionId: string | null): string | null {
    if (!sessionId) return null
    return members.find((member) => member.sessionId === sessionId)?.role ?? sessionId.slice(0, 8)
}

function MemberAvatar(props: { role: string; status?: TeamMember['status'] }) {
    return (
        <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--app-subtle-bg)] text-[10px] font-semibold text-[var(--app-fg)]">
            {props.role.slice(0, 1).toUpperCase()}
            {props.status ? (
                <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--app-bg)] ${statusDotClass(props.status)}`} />
            ) : null}
        </span>
    )
}

function ThreadRow(props: {
    messages: TeamMessage[]
    members: TeamMember[]
    expanded: boolean
    onToggle: () => void
}) {
    const { t } = useTranslation()
    const { messages, members, expanded, onToggle } = props
    const first = messages[0]!
    const last = messages[messages.length - 1]!
    const fromRole = roleOf(members, first.fromSessionId) ?? '?'
    const toRole = roleOf(members, first.toSessionId) ?? '?'
    const topics = first.text.replace(/\s+/g, ' ').slice(0, 28)

    return (
        <div className="my-1">
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-dashed border-[var(--app-border)] bg-[var(--app-subtle-bg)]/40 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--app-subtle-bg)]"
            >
                <MemberAvatar role={fromRole} />
                <span className="shrink-0 text-[var(--app-hint)]">↔</span>
                <MemberAvatar role={toRole} />
                <span className="hidden min-w-0 truncate font-medium text-[var(--app-fg)] split:inline">
                    {fromRole} ↔ {toRole}
                </span>
                <span className="shrink-0 text-[var(--app-hint)]">
                    {t('team.thread.count', { n: messages.length })}
                </span>
                <span className="hidden min-w-0 truncate text-[var(--app-hint)] split:inline">· {topics}</span>
                <span className="ml-auto shrink-0 font-medium text-[var(--app-link)]">
                    {expanded ? t('team.thread.collapse') : t('team.thread.expand')}
                </span>
            </button>
            {expanded ? (
                <div className="mt-1 ml-3 border-l-2 border-[var(--app-border)] pl-3">
                    {messages.map((message) => (
                        <MessageRow key={message.seq} message={message} members={members} compact />
                    ))}
                </div>
            ) : (
                <div className="mt-1 truncate pl-3 text-[11px] text-[var(--app-hint)]">
                    {last.fromSessionId === first.fromSessionId ? '' : `${roleOf(members, last.fromSessionId)}: `}
                    {last.text.replace(/\s+/g, ' ').slice(0, 60)}
                </div>
            )}
        </div>
    )
}

function MessageRow(props: { message: TeamMessage; members: TeamMember[]; compact?: boolean }) {
    const { t } = useTranslation()
    const { message, members, compact } = props

    if (message.fromKind === 'hub') {
        if (message.kind === 'task-assign') {
            return (
                <div className="my-1.5">
                    <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)]/50 px-3 py-2">
                        <div className="mb-0.5 text-[11px] font-semibold text-[var(--app-hint)]">{t('team.message.taskAssign')}</div>
                        <div className="whitespace-pre-wrap text-xs text-[var(--app-fg)]">{message.text}</div>
                    </div>
                </div>
            )
        }
        return (
            <div className="my-1 text-center text-[11px] text-[var(--app-hint)]">
                {message.text}
            </div>
        )
    }

    if (message.fromKind === 'human') {
        return (
            <div className="my-1.5 flex justify-end">
                <div className="max-w-[85%] rounded-xl bg-[var(--app-chat-user-bg)] px-3 py-2">
                    <div className="mb-0.5 text-[11px] font-semibold text-[var(--app-hint)]">
                        {t('team.message.you')}
                        {message.toSessionId ? ` → ${roleOf(members, message.toSessionId)}` : ''} · {formatTime(message.createdAt)}
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-[var(--app-chat-user-fg)]">{message.text}</div>
                </div>
            </div>
        )
    }

    const fromRole = roleOf(members, message.fromSessionId) ?? '?'
    const isDecision = message.kind === 'decision'
    return (
        <div className={`my-1.5 ${compact ? '' : 'max-w-[92%]'}`}>
            <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-[var(--app-hint)]">
                {!compact ? <MemberAvatar role={fromRole} /> : null}
                <span className="font-semibold text-[var(--app-fg)]">{fromRole}</span>
                <span>{message.toSessionId ? `→ ${roleOf(members, message.toSessionId)}` : `→ ${t('team.message.all')}`}</span>
                <span>· {formatTime(message.createdAt)}</span>
                {message.kind !== 'chat' ? <span className="rounded bg-[var(--app-subtle-bg)] px-1">{message.kind}</span> : null}
            </div>
            <div className={`rounded-xl border px-3 py-2 ${isDecision ? 'border-[var(--app-fg)] bg-[var(--app-subtle-bg)]/40' : 'border-[var(--app-border)] bg-[var(--app-bg)]'}`}>
                {isDecision ? <div className="mb-1 text-[11px] font-semibold text-[var(--app-fg)]">{t('team.message.decision')}</div> : null}
                <MarkdownRenderer content={message.text} className="text-sm" preserveSingleLineBreaks standalone />
            </div>
        </div>
    )
}

export function TeamTimeline(props: { messages: TeamMessage[]; members: TeamMember[]; foldThreads: boolean }) {
    const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
    const items = useMemo(
        () => buildTimelineItems(props.messages, props.foldThreads),
        [props.messages, props.foldThreads]
    )

    return (
        <div className="flex flex-col py-2">
            {items.map((item) => {
                if (item.type === 'thread') {
                    return (
                        <ThreadRow
                            key={item.key}
                            messages={item.messages}
                            members={props.members}
                            expanded={expandedThreads.has(item.key)}
                            onToggle={() => {
                                setExpandedThreads((current) => {
                                    const next = new Set(current)
                                    if (next.has(item.key)) {
                                        next.delete(item.key)
                                    } else {
                                        next.add(item.key)
                                    }
                                    return next
                                })
                            }}
                        />
                    )
                }
                return <MessageRow key={item.message.seq} message={item.message} members={props.members} />
            })}
        </div>
    )
}
