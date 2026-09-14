import { useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { queryKeys } from '@/lib/query-keys'
import { useTeam } from '@/hooks/queries/useTeam'
import { useTeamMessages } from '@/hooks/queries/useTeamMessages'
import { useTeamMemory } from '@/hooks/queries/useTeamMemory'
import type { TeamMessage } from '@/types/team'
import { TeamTimeline } from './TeamTimeline'
import { TeamSidePanel } from './TeamSidePanel'
import { TeamAddMemberDialog } from './TeamAddMemberDialog'
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
    const { files: memoryFiles } = useTeamMemory(api, teamId)

    const [filter, setFilter] = useState<Filter>('all')
    const [taskId, setTaskId] = useState<string>('')
    const [draft, setDraft] = useState('')
    const [to, setTo] = useState('all')
    const [sending, setSending] = useState(false)
    const [panelOpen, setPanelOpen] = useState(() => isWideViewport())
    const [addMemberOpen, setAddMemberOpen] = useState(false)
    const [memoryPath, setMemoryPath] = useState<string | null>(null)
    const [taskDialogId, setTaskDialogId] = useState<string | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)

    const members = detail?.members ?? []
    const tasks = detail?.tasks ?? []
    const leadSessionId = detail?.team.leadSessionId ?? null

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
                to: to === 'all' ? undefined : to,
                kind: 'chat',
            })
            setDraft('')
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
            memoryFiles={memoryFiles}
            activeTaskId={filter === 'task' ? taskId : null}
            onOpenSession={(sessionId) => navigate({ to: '/sessions/$sessionId', params: { sessionId } })}
            onSelectTask={(selectedTaskId) => setTaskDialogId(selectedTaskId)}
            onCreateTask={(input) => createTask.mutate(input)}
            creatingTask={createTask.isPending}
            onOpenMemoryFile={(path) => setMemoryPath(path)}
            onClose={() => setPanelOpen(false)}
        />
    )

    return (
        <div className="flex h-full min-h-0">
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2 border-b border-[var(--app-divider)] px-3 py-2">
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
                        onClick={() => setAddMemberOpen(true)}
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
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] split:ml-2"
                        title={t('team.panel.toggle')}
                        aria-label={t('team.panel.toggle')}
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="16" rx="2" />
                            <path d="M15 4v16" />
                        </svg>
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

                <div className="app-scroll-y min-h-0 flex-1 px-3">
                    {error || messagesError ? (
                        <div className="py-6 text-center text-sm text-red-600">{error ?? messagesError}</div>
                    ) : isLoading ? (
                        <div className="py-6 text-center text-sm text-[var(--app-hint)]">{t('team.loading')}</div>
                    ) : visibleMessages.length === 0 ? (
                        <div className="py-6 text-center text-sm text-[var(--app-hint)]">{t('team.empty')}</div>
                    ) : (
                        <TeamTimeline messages={visibleMessages} members={members} foldThreads={filter !== 'key'} />
                    )}
                </div>

                {archived ? (
                    <div className="border-t border-[var(--app-divider)] px-3 py-3 text-center text-xs text-[var(--app-hint)]">
                        {t('team.archivedHint')}
                    </div>
                ) : (
                <div className="border-t border-[var(--app-divider)] px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                        <select
                            value={to}
                            onChange={(event) => setTo(event.target.value)}
                            className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-0.5 text-[11px] text-[var(--app-fg)]"
                        >
                            <option value="all">{t('team.send.toAll')}</option>
                            {leadSessionId ? <option value="lead">{t('team.send.toLead')}</option> : null}
                            {members
                                .filter((member) => member.sessionId !== leadSessionId)
                                .map((member) => (
                                    <option key={member.sessionId} value={member.sessionId}>
                                        {member.role} · {memberStatusLabel(t, member.status)}
                                    </option>
                                ))}
                        </select>
                        <span className="text-[11px] text-[var(--app-hint)]">{t('team.send.hint')}</span>
                    </div>
                    <div className="flex items-end gap-2">
                        <textarea
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
                <div className="split:hidden fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setPanelOpen(false)}>
                    <div className="h-full w-[85%] max-w-[360px] bg-[var(--app-bg)]" onClick={(event) => event.stopPropagation()}>
                        {panel}
                    </div>
                </div>
            ) : null}

            <TeamMemoryDialog
                teamId={teamId}
                path={memoryPath}
                onClose={() => setMemoryPath(null)}
            />

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

            <TeamAddMemberDialog
                open={addMemberOpen}
                teamId={teamId}
                leadSessionId={leadSessionId}
                onClose={() => setAddMemberOpen(false)}
                onSpawned={(role) => {
                    setAddMemberOpen(false)
                    addToast({
                        title: t('team.add.success', { role }),
                        body: '',
                        sessionId: '',
                        url: '',
                    })
                }}
            />
        </div>
    )
}
