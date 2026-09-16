import { useState } from 'react'
import type { TeamMember, TeamMessage, TeamRequirement, TeamTask } from '@/types/team'
import { useTranslation } from '@/lib/use-translation'
import { humanReplyState } from '@/lib/teamMessageState'
import type { RequirementGroup } from '@/lib/teamRequirementGroups'
import { TeamTimeline } from './TeamTimeline'

function statusChipClass(status: string): string {
    switch (status) {
        case 'done':
            return 'bg-emerald-500/15 text-emerald-600'
        case 'blocked':
            return 'bg-amber-500/15 text-amber-600'
        case 'doing':
            return 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
        default:
            return 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
    }
}

/**
 * One requirement (a human ask) as a collapsible card: the conclusion (result)
 * and task progress stay visible while collapsed; the original ask and the full
 * process are one click away. A card with a pending decision opens by itself.
 */
export function TeamRequirementCard(props: {
    group: RequirementGroup
    members: TeamMember[]
    tasks: TeamTask[]
    onReply?: (message: TeamMessage) => void
    onAddNote?: (requirement: TeamRequirement) => void
}) {
    const { t } = useTranslation()
    const requirement = props.group.requirement
    const messages = props.group.messages
    const tasks = props.tasks
    const hasPendingDecision = messages.some((message) => humanReplyState(message) === 'pending')
    const [expanded, setExpanded] = useState(hasPendingDecision)
    const last = messages[messages.length - 1]
    const status = requirement?.status ?? 'open'
    const title = requirement ? requirement.title : t('team.requirement.other')
    const doneTasks = tasks.filter((task) => task.status === 'done').length
    const assignees = Array.from(new Set(tasks
        .map((task) => props.members.find((member) => member.sessionId === task.assigneeSessionId)?.role)
        .filter((role): role is string => Boolean(role))))

    return (
        <div
            className={`my-2 rounded-xl border bg-[var(--app-bg)] ${
                requirement ? 'border-l-[3px] border-l-[var(--app-link)] border-[var(--app-border)]' : 'border-dashed border-[var(--app-border)]'
            }`}
        >
            <div className="flex items-start gap-1 px-3 py-2">
                <button
                    type="button"
                    onClick={() => setExpanded((current) => !current)}
                    className="min-w-0 flex-1 text-left"
                >
                    <div className="flex flex-wrap items-center gap-1.5">
                        {requirement ? (
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusChipClass(status)}`}>
                                {t(`team.requirement.status.${status}`)}
                            </span>
                        ) : null}
                        <span className="min-w-0 truncate text-xs font-semibold text-[var(--app-fg)]">{title}</span>
                        {hasPendingDecision ? (
                            <span className="rounded bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-600">
                                {t('team.reply.pending')}
                            </span>
                        ) : null}
                    </div>
                    {requirement?.conclusion ? (
                        <div className="mt-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5">
                            <div className="text-[10px] font-semibold text-emerald-700">{t('team.requirement.conclusion')}</div>
                            <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[11px] text-[var(--app-fg)]">
                                {requirement.conclusion}
                            </div>
                        </div>
                    ) : last ? (
                        <div className="mt-1 truncate text-[11px] text-[var(--app-hint)]">
                            {last.text.replace(/\s+/g, ' ').slice(0, 80)}
                        </div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--app-hint)]">
                        <span>{t('team.requirement.messages', { n: messages.length })}</span>
                        {tasks.length > 0 ? (
                            <span>{t('team.requirement.tasks', { done: doneTasks, total: tasks.length })}</span>
                        ) : null}
                        {assignees.length > 0 ? <span className="truncate">{assignees.join(' · ')}</span> : null}
                    </div>
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                        type="button"
                        onClick={() => setExpanded((current) => !current)}
                        className="text-[11px] font-medium text-[var(--app-link)]"
                    >
                        {expanded ? t('team.thread.collapse') : t('team.thread.expand')}
                    </button>
                    {requirement && props.onAddNote ? (
                        <button
                            type="button"
                            onClick={() => props.onAddNote?.(requirement)}
                            className="rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[10px] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                        >
                            {t('team.requirement.addNote')}
                        </button>
                    ) : null}
                </div>
            </div>
            {expanded ? (
                <div className="border-t border-[var(--app-divider)] px-2 pb-2">
                    {requirement?.body ? (
                        <div className="mx-1 mt-2 rounded-lg bg-[var(--app-subtle-bg)]/50 px-2 py-1.5">
                            <div className="text-[10px] font-semibold text-[var(--app-hint)]">{t('team.requirement.original')}</div>
                            <div className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] text-[var(--app-fg)]">
                                {requirement.body}
                            </div>
                        </div>
                    ) : null}
                    <TeamTimeline messages={messages} members={props.members} foldThreads onReply={props.onReply} />
                </div>
            ) : null}
        </div>
    )
}
