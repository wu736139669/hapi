import { useState } from 'react'
import type { DirectoryEntry } from '@/types/api'
import type { TeamDetail, TeamTask } from '@/types/team'
import { useTranslation } from '@/lib/use-translation'
import { memberStatusLabel, statusDotClass } from './teamStatus'

function TaskColumn(props: {
    title: string
    tasks: TeamTask[]
    members: TeamDetail['members']
    activeTaskId: string | null
    onSelectTask: (taskId: string) => void
}) {
    const { t } = useTranslation()
    return (
        <div className="rounded-lg bg-[var(--app-subtle-bg)]/50 p-2">
            <div className="mb-1 text-[11px] font-semibold text-[var(--app-hint)]">
                {props.title} · {props.tasks.length}
            </div>
            <div className="flex flex-col gap-1">
                {props.tasks.length === 0 ? (
                    <div className="rounded-md border border-dashed border-[var(--app-border)] px-2 py-1.5 text-[11px] text-[var(--app-hint)]">
                        {t('team.panel.empty')}
                    </div>
                ) : null}
                {props.tasks.map((task) => {
                    const assignee = props.members.find((member) => member.sessionId === task.assigneeSessionId)
                    const active = props.activeTaskId === task.id
                    return (
                        <button
                            key={task.id}
                            type="button"
                            onClick={() => props.onSelectTask(task.id)}
                            className={`rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                                active
                                    ? 'border-[var(--app-fg)] bg-[var(--app-bg)]'
                                    : 'border-[var(--app-border)] bg-[var(--app-bg)] hover:bg-[var(--app-subtle-bg)]'
                            }`}
                        >
                            <div className={`truncate ${task.status === 'done' ? 'text-[var(--app-hint)] line-through' : 'text-[var(--app-fg)]'}`}>
                                {task.title}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--app-hint)]">
                                {assignee ? <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClass(assignee.status)}`} /> : null}
                                <span className="truncate">{assignee?.role ?? t('team.panel.unassigned')}</span>
                                {task.status === 'blocked' ? <span className="text-amber-500">⚠</span> : null}
                            </div>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

/**
 * Team side panel: members (live status, click to open the member session),
 * task board (click a task to replay it in the timeline) and budget info.
 */
export function TeamSidePanel(props: {
    detail: TeamDetail | null
    /** Team memory (repo-local, read through the lead session's file API). */
    memory: {
        root: string | null
        relativeDir: string
        entries: DirectoryEntry[]
        isLoading: boolean
        onEnterDir: (name: string) => void
        onGoBack: () => void
        onOpenFile: (name: string) => void
    }
    activeTaskId: string | null
    onOpenSession: (sessionId: string) => void
    /** Opens the task editor dialog (status/assignee + timeline). */
    onSelectTask: (taskId: string) => void
    onCreateTask: (input: { title: string; assigneeSessionId: string | null }) => void
    creatingTask: boolean
    onClose?: () => void
}) {
    const { t } = useTranslation()
    const [newTaskTitle, setNewTaskTitle] = useState('')
    const [newTaskAssignee, setNewTaskAssignee] = useState('')
    const detail = props.detail
    const members = detail?.members ?? []
    const tasks = detail?.tasks ?? []
    const todo = tasks.filter((task) => task.status === 'todo')
    const doing = tasks.filter((task) => task.status === 'doing' || task.status === 'blocked')
    const done = tasks.filter((task) => task.status === 'done')

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-[var(--app-divider)] px-3 py-2">
                <span className="text-sm font-semibold text-[var(--app-fg)]">{t('team.panel.title')}</span>
                {props.onClose ? (
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        aria-label={t('team.panel.close')}
                    >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                ) : null}
            </div>

            <div className="app-scroll-y min-h-0 flex-1 px-3 py-2">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('team.panel.members')} · {members.length}
                </div>
                <div className="mb-3 flex flex-col gap-0.5">
                    {members.map((member) => (
                        <button
                            key={member.sessionId}
                            type="button"
                            onClick={() => props.onOpenSession(member.sessionId)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--app-subtle-bg)]"
                            title={t('team.panel.openSession')}
                        >
                            <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(member.status)}`} />
                            <span className="min-w-0 truncate font-medium text-[var(--app-fg)]">{member.role}</span>
                            <span className="shrink-0 font-mono text-[10px] text-[var(--app-hint)]">{member.sessionId.slice(0, 8)}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-[var(--app-hint)]">{memberStatusLabel(t, member.status)}</span>
                        </button>
                    ))}
                </div>

                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('team.panel.tasks')}
                </div>
                <div className="mb-2 flex flex-col gap-1.5 rounded-lg border border-[var(--app-border)] p-2">
                    <input
                        value={newTaskTitle}
                        onChange={(event) => setNewTaskTitle(event.target.value)}
                        placeholder={t('team.task.newPlaceholder')}
                        className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-xs text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                    />
                    <div className="flex items-center gap-1.5">
                        <select
                            value={newTaskAssignee}
                            onChange={(event) => setNewTaskAssignee(event.target.value)}
                            className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-[11px] text-[var(--app-fg)]"
                        >
                            <option value="">{t('team.panel.unassigned')}</option>
                            {members.map((member) => (
                                <option key={member.sessionId} value={member.sessionId}>{member.role}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            disabled={props.creatingTask || newTaskTitle.trim().length === 0}
                            onClick={() => {
                                props.onCreateTask({
                                    title: newTaskTitle.trim(),
                                    assigneeSessionId: newTaskAssignee || null,
                                })
                                setNewTaskTitle('')
                                setNewTaskAssignee('')
                            }}
                            className="shrink-0 rounded-md bg-[var(--app-fg)] px-2.5 py-1 text-[11px] font-medium text-[var(--app-bg)] disabled:opacity-40"
                        >
                            {t('team.task.add')}
                        </button>
                    </div>
                </div>
                <div className="mb-3 flex flex-col gap-2">
                    <TaskColumn
                        title={t('team.panel.todo')}
                        tasks={todo}
                        members={members}
                        activeTaskId={props.activeTaskId}
                        onSelectTask={props.onSelectTask}
                    />
                    <TaskColumn
                        title={t('team.panel.doing')}
                        tasks={doing}
                        members={members}
                        activeTaskId={props.activeTaskId}
                        onSelectTask={props.onSelectTask}
                    />
                    <TaskColumn
                        title={t('team.panel.done')}
                        tasks={done}
                        members={members}
                        activeTaskId={props.activeTaskId}
                        onSelectTask={props.onSelectTask}
                    />
                </div>

                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('team.memory.title')}
                </div>
                <div className="mb-3 flex flex-col gap-0.5">
                    {!props.memory.root ? (
                        <span className="px-2 text-[11px] leading-relaxed text-[var(--app-hint)]">
                            {t('team.memory.repoHint')}
                        </span>
                    ) : (
                        <>
                            <div className="flex items-center gap-1 px-2 pb-1 font-mono text-[10px] text-[var(--app-hint)]">
                                {props.memory.relativeDir ? (
                                    <button
                                        type="button"
                                        onClick={props.memory.onGoBack}
                                        className="shrink-0 text-[var(--app-link)]"
                                    >
                                        ‹
                                    </button>
                                ) : null}
                                <span className="min-w-0 truncate">
                                    .hapi/team{props.memory.relativeDir ? `/${props.memory.relativeDir}` : ''}
                                </span>
                            </div>
                            {props.memory.isLoading ? (
                                <span className="px-2 text-[11px] text-[var(--app-hint)]">{t('team.memory.loading')}</span>
                            ) : props.memory.entries.length === 0 ? (
                                <span className="px-2 text-[11px] text-[var(--app-hint)]">{t('team.memory.empty')}</span>
                            ) : null}
                            {props.memory.entries.map((entry) => (
                                <button
                                    key={entry.name}
                                    type="button"
                                    onClick={() => {
                                        if (entry.type === 'directory') {
                                            props.memory.onEnterDir(entry.name)
                                        } else {
                                            props.memory.onOpenFile(entry.name)
                                        }
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--app-subtle-bg)]"
                                >
                                    {entry.type === 'directory' ? (
                                        <svg className="h-3.5 w-3.5 shrink-0 text-[var(--app-hint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                                        </svg>
                                    ) : (
                                        <svg className="h-3.5 w-3.5 shrink-0 text-[var(--app-hint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                            <path d="M14 2v6h6" />
                                        </svg>
                                    )}
                                    <span className="min-w-0 truncate text-[var(--app-fg)]">{entry.name}{entry.type === 'directory' ? '/' : ''}</span>
                                </button>
                            ))}
                        </>
                    )}
                </div>

                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('team.panel.budget')}
                </div>
                <div className="flex flex-col gap-0.5 text-[11px] text-[var(--app-hint)]">
                    <span>{t('team.panel.budget.members', { n: members.length, max: readBudgetNumber(detail, 'maxMembers', 5) })}</span>
                    <span>{t('team.panel.budget.messages', { n: readBudgetNumber(detail, 'maxMessagesPerMinute', 30) })}</span>
                    <span>{t('team.panel.budget.chain', { n: readBudgetNumber(detail, 'maxChainDepth', 8) })}</span>
                </div>
            </div>
        </div>
    )
}

function readBudgetNumber(detail: TeamDetail | null, key: string, fallback: number): number {
    const budget = detail?.team.config?.budget
    if (budget !== null && typeof budget === 'object' && !Array.isArray(budget)) {
        const value = (budget as Record<string, unknown>)[key]
        if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
            return value
        }
    }
    return fallback
}
