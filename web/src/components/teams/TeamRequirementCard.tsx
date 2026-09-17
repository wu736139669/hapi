import { useMemo, useState } from 'react'
import type { TeamMember, TeamMessage, TeamRequirement, TeamTask } from '@/types/team'
import { useTranslation } from '@/lib/use-translation'
import { humanReplyState } from '@/lib/teamMessageState'
import { requirementOutcome, selectMilestones } from '@/lib/requirementSummary'
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
 * One requirement as a question/answer card: your ask plus the result stay
 * visible while collapsed; the process opens to key milestones first and the
 * full message stream only on request.
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
    const [showAll, setShowAll] = useState(false)

    // The opening human message IS the ask shown at the top; hide it here so the
    // same sentence is not repeated inside the process.
    const openingAskSeq = requirement ? (messages.find((message) => message.fromKind === 'human')?.seq ?? null) : null
    const timelineMessages = openingAskSeq === null
        ? messages
        : messages.filter((message) => message.seq !== openingAskSeq)
    const milestones = useMemo(() => selectMilestones(timelineMessages), [timelineMessages])
    const hiddenCount = timelineMessages.length - milestones.length
    const outcome = requirementOutcome(requirement, tasks, messages)
    const askText = requirement?.body?.trim() || requirement?.title || null
    const title = requirement ? requirement.title : t('team.requirement.other')
    const assignees = Array.from(new Set(tasks
        .map((task) => props.members.find((member) => member.sessionId === task.assigneeSessionId)?.role)
        .filter((role): role is string => Boolean(role))))
    const shown = showAll ? timelineMessages : milestones

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
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusChipClass(requirement.status)}`}>
                                {t(`team.requirement.status.${requirement.status}`)}
                            </span>
                        ) : null}
                        {askText ? null : (
                            <span className="min-w-0 truncate text-xs font-semibold text-[var(--app-fg)]">{title}</span>
                        )}
                        {hasPendingDecision ? (
                            <span className="rounded bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-600">
                                {t('team.reply.pending')}
                            </span>
                        ) : null}
                    </div>

                    {askText ? (
                        <div className="mt-1.5 rounded-lg bg-[var(--app-subtle-bg)]/60 px-2 py-1.5">
                            <div className="text-[10px] font-semibold text-[var(--app-hint)]">{t('team.requirement.yourAsk')}</div>
                            <div className={`mt-0.5 whitespace-pre-wrap text-[11px] text-[var(--app-fg)] ${expanded ? '' : 'line-clamp-3'}`}>
                                {askText}
                            </div>
                        </div>
                    ) : null}

                    {outcome.kind === 'conclusion' ? (
                        <div className="mt-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5">
                            <div className="text-[10px] font-semibold text-emerald-700">{t('team.requirement.result')}</div>
                            <div className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-[11px] text-[var(--app-fg)]">
                                {requirement?.conclusion}
                            </div>
                        </div>
                    ) : outcome.kind === 'tasks' ? (
                        <div className="mt-1.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-subtle-bg)]/40 px-2 py-1.5">
                            <div className="text-[10px] font-semibold text-[var(--app-hint)]">{t('team.requirement.result')}</div>
                            <div className="mt-0.5 text-[11px] text-[var(--app-fg)]">
                                {outcome.doneTasks === outcome.totalTasks
                                    ? t('team.requirement.resultTasks', { done: outcome.doneTasks, total: outcome.totalTasks })
                                    : t('team.requirement.resultProgress', { done: outcome.doneTasks, total: outcome.totalTasks })}
                            </div>
                            {outcome.deliverable ? (
                                <div className="mt-0.5 line-clamp-2 text-[10px] text-[var(--app-hint)]">
                                    {t('team.requirement.deliverable')}：{outcome.deliverable}
                                </div>
                            ) : outcome.latestText ? (
                                <div className="mt-0.5 truncate text-[10px] text-[var(--app-hint)]">{outcome.latestText}</div>
                            ) : null}
                        </div>
                    ) : outcome.latestText ? (
                        <div className="mt-1 truncate text-[11px] text-[var(--app-hint)]">{outcome.latestText}</div>
                    ) : null}

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--app-hint)]">
                        <span>{t('team.requirement.messages', { n: messages.length })}</span>
                        {tasks.length > 0 ? (
                            <span>{t('team.requirement.tasks', { done: outcome.doneTasks, total: outcome.totalTasks })}</span>
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
                    <div className="mx-1 mt-2 flex items-center gap-2 text-[10px] text-[var(--app-hint)]">
                        <span>{showAll ? t('team.requirement.allProcess') : t('team.requirement.milestones')}</span>
                        {hiddenCount > 0 || showAll ? (
                            <button
                                type="button"
                                onClick={() => setShowAll((current) => !current)}
                                className="text-[var(--app-link)]"
                            >
                                {showAll ? t('team.requirement.showMilestones') : t('team.requirement.showAll', { n: hiddenCount })}
                            </button>
                        ) : null}
                    </div>
                    <TeamTimeline messages={shown} members={props.members} foldThreads={showAll} onReply={props.onReply} />
                </div>
            ) : null}
        </div>
    )
}
