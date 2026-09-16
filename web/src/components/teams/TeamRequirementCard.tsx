import { useState } from 'react'
import type { TeamMember, TeamMessage } from '@/types/team'
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
 * One requirement (a human ask) as a collapsible card: title + status +
 * conclusion/result on top, the full process behind "展开". Cards default to
 * collapsed so the timeline reads as a list of asks; a card with a pending
 * decision opens automatically.
 */
export function TeamRequirementCard(props: {
    group: RequirementGroup
    members: TeamMember[]
    onReply?: (message: TeamMessage) => void
}) {
    const { t } = useTranslation()
    const requirement = props.group.requirement
    const messages = props.group.messages
    const hasPendingDecision = messages.some((message) => humanReplyState(message) === 'pending')
    const [expanded, setExpanded] = useState(hasPendingDecision)
    const last = messages[messages.length - 1]
    const status = requirement?.status ?? 'open'
    const title = requirement ? requirement.title : t('team.requirement.other')

    return (
        <div className="my-2 rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)]">
            <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left"
            >
                <div className="min-w-0 flex-1">
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
                        <div className="mt-1 line-clamp-2 text-[11px] text-[var(--app-hint)]">
                            {t('team.requirement.conclusion')}：{requirement.conclusion}
                        </div>
                    ) : last ? (
                        <div className="mt-1 truncate text-[11px] text-[var(--app-hint)]">
                            {last.text.replace(/\s+/g, ' ').slice(0, 80)}
                        </div>
                    ) : null}
                    <div className="mt-0.5 text-[10px] text-[var(--app-hint)]">
                        {t('team.requirement.messages', { n: messages.length })}
                    </div>
                </div>
                <span className="mt-0.5 shrink-0 text-[11px] font-medium text-[var(--app-link)]">
                    {expanded ? t('team.thread.collapse') : t('team.thread.expand')}
                </span>
            </button>
            {expanded ? (
                <div className="border-t border-[var(--app-divider)] px-2 pb-2">
                    <TeamTimeline messages={messages} members={props.members} foldThreads onReply={props.onReply} />
                </div>
            ) : null}
        </div>
    )
}
