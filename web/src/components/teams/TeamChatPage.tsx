import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { queryKeys } from '@/lib/query-keys'
import { useTeam } from '@/hooks/queries/useTeam'
import { useTeamMessages } from '@/hooks/queries/useTeamMessages'
import { useSession } from '@/hooks/queries/useSession'
import { useSessionDirectory } from '@/hooks/queries/useSessionDirectory'
import type { TeamMessage, TeamRequirement } from '@/types/team'
import { pendingHumanDecisions } from '@/lib/teamMessageState'
import { TeamTimeline } from './TeamTimeline'
import { TeamSidePanel } from './TeamSidePanel'
import { TeamRequirementCard } from './TeamRequirementCard'
import { groupMessagesByRequirement } from '@/lib/teamRequirementGroups'
import { TeamMemoryDialog } from './TeamMemoryDialog'
import { TeamSettingsDialog } from './TeamSettingsDialog'
import { TeamTaskDialog } from './TeamTaskDialog'
import { memberStatusLabel, statusDotClass } from './teamStatus'

type Filter = 'all' | 'key' | 'task'

function isKeyMessage(message: TeamMessage, leadSessionId: string | null): boolean {
    if (message.fromKind === 'human') return true
    if (leadSessionId && message.fromSessionId === leadSessionId) return true
    return message.kind === 'task-assign' || message.kind === 'task-update' || message.kind === 'decision'
}

function isWideViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(min-width: 920px)').matches
}

export function TeamChatPage() {
    const { teamId } = useParams({ from: '/sessions/teams/$teamId' })
    const navigate = useNavigate()
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const queryClient = useQueryClient()

    const { detail, isLoading, error } = useTeam(api, teamId)
    const { messages, error: messagesError } = useTeamMessages(api, teamId)

    const [filter, setFilter] = useState<Filter>('all')
    const [taskId, setTaskId] = useState<string>('')
    const [draft, setDraft] = useState('')
    const [to, setTo] = useState<string>('')
    const [replyTo, setReplyTo] = useState<TeamMessage | null>(null)
    const [sending, setSending] = useState(false)
    const [panelOpen, setPanelOpen] = useState(() => isWideViewport())
    const [memoryFilePath, setMemoryFilePath] = useState<string | null>(null)
    const [taskDialogId, setTaskDialogId] = useState<string | null>(null)
    const [requirementTarget, setRequirementTarget] = useState<string>('auto')
    const composerRef = useRef<HTMLTextAreaElement | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)

    const members = detail?.members ?? []
    const tasks = detail?.tasks ?? []
    const leadSessionId = detail?.team.leadSessionId ?? null

    // Smart scroll: stay pinned to the newest message while the human is at the
    // bottom; otherwise offer a jump button instead of yanking them away.
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const pinnedToBottomRef = useRef(true)
    const [showJumpToLatest, setShowJumpToLatest] = useState(false)
    const scrollToLatest = (behavior: ScrollBehavior = 'auto') => {
        const element = scrollRef.current
        if (!element) return
        element.scrollTo({ top: element.scrollHeight, behavior })
        pinnedToBottomRef.current = true
        setShowJumpToLatest(false)
    }

    // Humans talk to the lead by default; the lead routes the work.
    useEffect(() => {
        if (to) return
        if (leadSessionId) {
            setTo('lead')
            return
        }
        const first = members[0]
        if (first) setTo(first.sessionId)
    }, [to, leadSessionId, members])

    // Decisions waiting for the human ("待你确认" inbox).
    const pendingDecisions = useMemo(() => pendingHumanDecisions(messages), [messages])

    // Team memory lives in the repo (lead's machine): read it through the
    // session file API so remote runners work too.
    const { session: leadSession } = useSession(api, leadSessionId)
    const memoryRoot = leadSession?.metadata?.teamMemoryPath ?? null
    const [memoryDir, setMemoryDir] = useState('')
    const memoryAbsoluteDir = memoryRoot ? (memoryDir ? `${memoryRoot}/${memoryDir}` : memoryRoot) : ''
    const { entries: memoryEntries, isLoading: memoryLoading } = useSessionDirectory(
        api,
        leadSessionId,
        memoryAbsoluteDir,
        { enabled: Boolean(leadSessionId && memoryRoot) }
    )

    const visibleMessages = useMemo(() => {
        if (filter === 'key') {
            return messages.filter((message) => isKeyMessage(message, leadSessionId))
        }
        if (filter === 'task' && taskId) {
            const task = tasks.find((candidate) => candidate.id === taskId)
            if (!task) return messages
            return messages.filter((message) => {
                const metaTaskId = message.meta && typeof message.meta.taskId === 'string' ? message.meta.taskId : null
                if (metaTaskId === task.id) return true
                if (task.assigneeSessionId && message.fromSessionId === task.assigneeSessionId) return true
                if (task.assigneeSessionId && message.toSessionId === task.assigneeSessionId && message.kind === 'task-assign') return true
                return false
            })
        }
        return messages
    }, [filter, messages, taskId, tasks, leadSessionId])

    const completedTasks = tasks.filter((task) => task.status === 'done').length

    const requirementGroups = useMemo(
        () => groupMessagesByRequirement(detail?.requirements ?? [], visibleMessages),
        [detail?.requirements, visibleMessages]
    )

    // Open (or switch) a team at its newest message.
    useEffect(() => {
        scrollToLatest()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [teamId])

    // Follow new messages only while the human is already at the bottom.
    useEffect(() => {
        if (pinnedToBottomRef.current) {
            scrollToLatest()
        } else {
            setShowJumpToLatest(true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleMessages.length])

    const createTask = useMutation({
        mutationFn: async (input: { title: string; assigneeSessionId: string | null }) => {
            if (!api) throw new Error('API unavailable')
            return await api.createTeamTask(teamId, input)
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.team(teamId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.teamMessages(teamId) }),
            ])
        },
        onError: (mutationError) => {
            addToast({
                title: t('team.task.createFailed'),
                body: mutationError instanceof Error ? mutationError.message : t('dialog.error.default'),
                sessionId: '',
                url: '',
            })
        },
    })

    const archived = detail?.team.status === 'archived'
    const taskDialogTask = tasks.find((task) => task.id === taskDialogId) ?? null

    const handleSend = async () => {
        const text = draft.trim()
        if (!api || !text || sending) return
        setSending(true)
        try {
            await api.sendHumanTeamMessage(teamId, {
                text,
                to: to || undefined,
                kind: 'chat',
                ...(replyTo ? { inReplyTo: replyTo.seq } : {}),
                ...(requirementTarget !== 'auto' && requirementTarget !== 'new' ? { requirementId: requirementTarget } : {}),
                ...(requirementTarget === 'new' ? { newRequirement: true } : {}),
            })
            setDraft('')
            setReplyTo(null)
        } catch (sendError) {
            addToast({
                title: t('team.send.failed'),
                body: sendError instanceof Error ? sendError.message : t('dialog.error.default'),
                sessionId: '',
                url: '',
            })
        } finally {
            setSending(false)
        }
    }

    const handleReply = (message: TeamMessage) => {
        setReplyTo(message)
        if (message.fromSessionId) {
            setTo(message.fromSessionId)
        }
    }

    /** "补充说明": thread the next message under the requirement's first message. */
    const handleAddNote = (requirement: TeamRequirement) => {
        const first = requirementGroups.find((group) => group.requirement?.id === requirement.id)?.messages[0]
        if (first) {
            setReplyTo(first)
        }
        setRequirementTarget(requirement.id)
        if (leadSessionId) {
            setTo(leadSessionId)
        }
        composerRef.current?.focus()
    }

    const dismissDecision = useMutation({
        mutationFn: async (message: TeamMessage) => {
            if (!api) throw new Error('API unavailable')
            return await api.dismissTeamMessage(teamId, message.seq)
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.teamMessages(teamId) })
        },
        onError: (mutationError) => {
            addToast({
                title: t('team.pending.dismissFailed'),
                body: mutationError instanceof Error ? mutationError.message : t('dialog.error.default'),
                sessionId: '',
                url: '',
            })
        },
    })

    const removeMember = useMutation({
        mutationFn: async (input: { sessionId: string; stopSession: boolean }) => {
            if (!api) throw new Error('API unavailable')
            return await api.removeTeamMember(teamId, input.sessionId, input.stopSession)
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.team(teamId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.teams }),
            ])
        },
        onError: (mutationError) => {
            addToast({
                title: t('team.member.removeFailed'),
                body: mutationError instanceof Error ? mutationError.message : t('dialog.error.default'),
                sessionId: '',
                url: '',
            })
        },
    })

    const handleSelectTask = (selectedTaskId: string) => {
        setFilter('task')
        setTaskId(selectedTaskId)
        if (!isWideViewport()) {
            setPanelOpen(false)
        }
    }

    const panel = (
        <TeamSidePanel
            detail={detail}
            memory={{
                root: memoryRoot,
                relativeDir: memoryDir,
                entries: memoryEntries,
                isLoading: memoryLoading,
                onEnterDir: (name) => setMemoryDir((current) => (current ? `${current}/${name}` : name)),
                onGoBack: () => setMemoryDir((current) => current.split('/').slice(0, -1).join('/')),
                onOpenFile: (name) => {
                    if (memoryRoot) {
                        setMemoryFilePath(`${memoryAbsoluteDir}/${name}`)
                    }
                }
            }}
            pendingDecisions={pendingDecisions}
            dismissingDecision={dismissDecision.isPending}
            onReplyDecision={handleReply}
            onDismissDecision={(message) => dismissDecision.mutate(message)}
            activeTaskId={filter === 'task' ? taskId : null}
            onOpenSession={(sessionId) => navigate({ to: '/sessions/$sessionId', params: { sessionId } })}
            onRemoveMember={(sessionId, stopSession) => removeMember.mutate({ sessionId, stopSession })}
            onSelectTask={(selectedTaskId) => setTaskDialogId(selectedTaskId)}
            onCreateTask={(input) => createTask.mutate(input)}
            creatingTask={createTask.isPending}
            onClose={() => setPanelOpen(false)}
        />
    )

    return (
        <div className="flex h-full min-h-0">
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2 border-b border-[var(--app-divider)] px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
                    <button
                        type="button"
                        onClick={() => navigate({ to: '/sessions' })}
                        className="split:hidden flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        aria-label={t('team.back')}
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m15 18-6-6 6-6" />
                        </svg>
                    </button>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-[var(--app-fg)]">
                                {detail?.team.name ?? t('team.title')}
                            </span>
                            <span className="shrink-0 rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--app-hint)]">
                                {t('team.badge')}
                            </span>
                        </div>
                        {tasks.length > 0 ? (
                            <div className="text-[11px] text-[var(--app-hint)]">
                                {t('team.tasks.progress', { done: completedTasks, total: tasks.length })}
                            </div>
                        ) : null}
                    </div>
                    <div className="ml-auto hidden max-w-[55%] flex-wrap items-center justify-end gap-1.5 split:flex">
                        {members.map((member) => (
                            <span key={member.sessionId} className="inline-flex items-center gap-1 rounded-full bg-[var(--app-subtle-bg)] px-2 py-0.5 text-[11px] text-[var(--app-fg)]">
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClass(member.status)}`} />
                                {member.role}
                                <span className="text-[10px] text-[var(--app-hint)]">{memberStatusLabel(t, member.status)}</span>
                            </span>
                        ))}
                    </div>
                    {archived ? (
                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            {t('team.section.archived')}
                        </span>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => navigate({
                            to: '/sessions/new',
                            search: { teamId, teamName: detail?.team.name }
                        })}
                        className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        title={t('team.add.title')}
                        aria-label={t('team.add.title')}
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M19 8v6M22 11h-6" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        onClick={() => setSettingsOpen(true)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        title={t('team.settings.title')}
                        aria-label={t('team.settings.title')}
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        onClick={() => setPanelOpen((open) => !open)}
                        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] split:ml-2"
                        title={t('team.panel.toggle')}
                        aria-label={t('team.panel.toggle')}
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="16" rx="2" />
                            <path d="M15 4v16" />
                        </svg>
                        {pendingDecisions.length > 0 ? (
                            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                                {pendingDecisions.length}
                            </span>
                        ) : null}
                    </button>
                </div>

                <div className="flex items-center gap-2 border-b border-[var(--app-divider)] px-3 py-1.5">
                    {(['all', 'key', 'task'] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setFilter(value)}
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                                filter === value
                                    ? 'bg-[var(--app-fg)] text-[var(--app-bg)]'
                                    : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:text-[var(--app-fg)]'
                            }`}
                        >
                            {value === 'all' ? t('team.filter.all') : value === 'key' ? t('team.filter.key') : t('team.filter.task')}
                        </button>
                    ))}
                    {filter === 'task' ? (
                        <select
                            value={taskId}
                            onChange={(event) => setTaskId(event.target.value)}
                            className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-0.5 text-[11px] text-[var(--app-fg)]"
                        >
                            <option value="">{t('team.filter.taskPlaceholder')}</option>
                            {tasks.map((task) => (
                                <option key={task.id} value={task.id}>{task.title}</option>
                            ))}
                        </select>
                    ) : null}
                </div>

                <div
                    ref={scrollRef}
                    onScroll={(event) => {
                        const element = event.currentTarget
                        const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80
                        pinnedToBottomRef.current = nearBottom
                        if (nearBottom) setShowJumpToLatest(false)
                    }}
                    className="app-scroll-y min-h-0 flex-1 px-3"
                >
                    {error || messagesError ? (
                        <div className="py-6 text-center text-sm text-red-600">{error ?? messagesError}</div>
                    ) : isLoading ? (
                        <div className="py-6 text-center text-sm text-[var(--app-hint)]">{t('team.loading')}</div>
                    ) : visibleMessages.length === 0 ? (
                        <div className="py-6 text-center text-sm text-[var(--app-hint)]">{t('team.empty')}</div>
                    ) : filter === 'all' ? (
                        <div className="flex flex-col pb-2">
                            {requirementGroups.map((group) => (
                                <TeamRequirementCard
                                    key={group.requirement?.id ?? 'unassigned'}
                                    group={group}
                                    members={members}
                                    tasks={tasks.filter((task) => {
                                        const metaRequirementId = task.meta && typeof task.meta.requirementId === 'string' ? task.meta.requirementId : null
                                        return group.requirement ? metaRequirementId === group.requirement.id : metaRequirementId === null
                                    })}
                                    onReply={handleReply}
                                    onAddNote={handleAddNote}
                                />
                            ))}
                        </div>
                    ) : (
                        <TeamTimeline
                            messages={visibleMessages}
                            members={members}
                            foldThreads={filter !== 'key'}
                            onReply={handleReply}
                        />
                    )}
                </div>

                {showJumpToLatest ? (
                    <div className="flex justify-end px-3 pb-1">
                        <button
                            type="button"
                            onClick={() => scrollToLatest('smooth')}
                            className="rounded-full bg-[var(--app-fg)] px-3 py-1 text-[11px] font-medium text-[var(--app-bg)] shadow"
                        >
                            {t('team.jumpToLatest')}
                        </button>
                    </div>
                ) : null}

                {archived ? (
                    <div className="border-t border-[var(--app-divider)] px-3 py-3 text-center text-xs text-[var(--app-hint)]">
                        {t('team.archivedHint')}
                    </div>
                ) : (
                <div className="border-t border-[var(--app-divider)] px-3 py-2">
                    {replyTo ? (
                        <div className="mb-1 flex items-center gap-2 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700">
                            <span className="min-w-0 truncate">
                                {t('team.reply.replyingTo', {
                                    role: members.find((member) => member.sessionId === replyTo.fromSessionId)?.role ?? '?',
                                })}
                            </span>
                            <button
                                type="button"
                                onClick={() => setReplyTo(null)}
                                className="ml-auto shrink-0 font-medium underline"
                            >
                                {t('team.reply.cancel')}
                            </button>
                        </div>
                    ) : null}
                    <div className="mb-1 flex items-center gap-2">
                        <select
                            value={to}
                            onChange={(event) => {
                                setTo(event.target.value)
                                if (replyTo && event.target.value !== replyTo.fromSessionId) {
                                    setReplyTo(null)
                                }
                            }}
                            className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-0.5 text-[11px] text-[var(--app-fg)]"
                        >
                            {leadSessionId ? <option value="lead">{t('team.send.toLead')}</option> : null}
                            {members
                                .filter((member) => member.sessionId !== leadSessionId)
                                .map((member) => (
                                    <option key={member.sessionId} value={member.sessionId}>
                                        {member.role} · {memberStatusLabel(t, member.status)}
                                    </option>
                                ))}
                        </select>
                        <select
                            value={requirementTarget}
                            onChange={(event) => setRequirementTarget(event.target.value)}
                            title={t('team.send.requirement')}
                            className="max-w-[40%] rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-0.5 text-[11px] text-[var(--app-fg)]"
                        >
                            <option value="auto">{t('team.send.requirementAuto')}</option>
                            <option value="new">{t('team.send.requirementNew')}</option>
                            {(detail?.requirements ?? []).map((requirement) => (
                                <option key={requirement.id} value={requirement.id}>
                                    {requirement.title.slice(0, 24)}
                                </option>
                            ))}
                        </select>
                        <span className="text-[11px] text-[var(--app-hint)]">{t('team.send.hint')}</span>
                    </div>
                    <div className="flex items-end gap-2">
                        <textarea
                            ref={composerRef}
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault()
                                    void handleSend()
                                }
                            }}
                            rows={1}
                            placeholder={t('team.send.placeholder')}
                            className="min-h-[34px] flex-1 resize-none rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        />
                        <button
                            type="button"
                            onClick={() => void handleSend()}
                            disabled={sending || draft.trim().length === 0}
                            className="rounded-lg bg-[var(--app-fg)] px-3 py-2 text-sm font-medium text-[var(--app-bg)] disabled:opacity-40"
                        >
                            {t('team.send.button')}
                        </button>
                    </div>
                </div>
                )}
            </div>

            {panelOpen ? (
                <aside className="hidden w-[320px] shrink-0 flex-col border-l border-[var(--app-divider)] bg-[var(--app-bg)] split:flex">
                    {panel}
                </aside>
            ) : null}

            {panelOpen ? (
                <div className="split:hidden fixed inset-0 z-50 flex justify-end bg-black/30 pt-[env(safe-area-inset-top)]" onClick={() => setPanelOpen(false)}>
                    <div className="h-full w-[85%] max-w-[360px] bg-[var(--app-bg)]" onClick={(event) => event.stopPropagation()}>
                        {panel}
                    </div>
                </div>
            ) : null}

            {leadSessionId ? (
                <TeamMemoryDialog
                    leadSessionId={leadSessionId}
                    path={memoryFilePath}
                    onClose={() => setMemoryFilePath(null)}
                />
            ) : null}

            <TeamTaskDialog
                open={Boolean(taskDialogTask)}
                teamId={teamId}
                task={taskDialogTask}
                members={members}
                onClose={() => setTaskDialogId(null)}
                onViewTimeline={(selectedTaskId) => {
                    setTaskDialogId(null)
                    handleSelectTask(selectedTaskId)
                }}
            />

            <TeamSettingsDialog
                open={settingsOpen}
                team={detail?.team ?? null}
                onClose={() => setSettingsOpen(false)}
                onChanged={() => setSettingsOpen(false)}
                onDeleted={() => {
                    setSettingsOpen(false)
                    void queryClient.invalidateQueries({ queryKey: queryKeys.teams })
                    navigate({ to: '/sessions' })
                }}
            />
        </div>
    )
}
