import { useNavigate } from '@tanstack/react-router'
import type { TeamOverviewMember, TeamOverviewTeam } from '@hapi/protocol/apiTypes'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useTeamOverview } from '@/hooks/queries/useTeamOverview'
import { memberStatusLabel, statusDotClass, type TranslateFn } from './teamStatus'

function formatTokens(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
    return String(value)
}

function formatRelative(t: TranslateFn, timestamp: number | null): string {
    if (!timestamp) return t('dashboard.never')
    const diff = Math.max(0, Date.now() - timestamp)
    if (diff < 60_000) return t('dashboard.time.justNow')
    const minutes = Math.floor(diff / 60_000)
    if (minutes < 60) return t('dashboard.time.minutes', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('dashboard.time.hours', { n: hours })
    return t('dashboard.time.days', { n: Math.floor(hours / 24) })
}

function SummaryTile(props: { label: string; value: number | string; accent?: 'amber' | 'emerald' }) {
    const accent = props.accent === 'amber'
        ? 'text-amber-600'
        : props.accent === 'emerald'
            ? 'text-emerald-600'
            : 'text-[var(--app-fg)]'
    return (
        <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2">
            <div className={`text-xl font-semibold tabular-nums ${accent}`}>{props.value}</div>
            <div className="mt-0.5 text-[11px] text-[var(--app-hint)]">{props.label}</div>
        </div>
    )
}

function MemberRow(props: {
    member: TeamOverviewMember
    isLead: boolean
    onOpen: () => void
}) {
    const { t } = useTranslation()
    const { member } = props
    return (
        <button
            type="button"
            onClick={props.onOpen}
            className="flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
        >
            <div className="flex min-w-0 items-center gap-2">
                <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(member.status)}`} />
                <span className="shrink-0 text-xs font-medium text-[var(--app-fg)]">{member.role}</span>
                {props.isLead ? (
                    <span className="shrink-0 rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--app-hint)]">
                        LEAD
                    </span>
                ) : null}
                <span className="shrink-0 text-[10px] text-[var(--app-hint)]">{memberStatusLabel(t, member.status)}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--app-hint)]">
                    {member.sessionId.slice(0, 8)}
                </span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-3.5 text-[11px] text-[var(--app-hint)]">
                <span className="min-w-0 flex-1 truncate">
                    <span className="text-[var(--app-fg)]">
                        {member.currentTask ? member.currentTask.title : t('dashboard.member.noTask')}
                    </span>
                </span>
                <span className="shrink-0">
                    {t('dashboard.member.lastReport')}: {formatRelative(t, member.lastReportAt)}
                </span>
                {member.usage ? (
                    <span className="shrink-0 tabular-nums" title={t('dashboard.member.usage')}>
                        {formatTokens(member.usage.last24hTokens)} / {formatTokens(member.usage.totalTokens)}
                    </span>
                ) : null}
            </div>
        </button>
    )
}

function TeamCard(props: {
    team: TeamOverviewTeam
    onOpenTeam: () => void
    onOpenSession: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const { team } = props
    const active = team.status === 'active'
    return (
        <section className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)]">
            <header className="flex flex-wrap items-center gap-2 border-b border-[var(--app-divider)] px-3 py-2">
                <button
                    type="button"
                    onClick={props.onOpenTeam}
                    className="flex min-w-0 items-center gap-2 text-left"
                >
                    <span className="truncate text-sm font-semibold text-[var(--app-fg)]">{team.name}</span>
                    <span className="shrink-0 text-[10px] text-[var(--app-hint)]">
                        {t('team.section.members', { n: team.members.length })}
                    </span>
                </button>
                {!active ? (
                    <span className="shrink-0 rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--app-hint)]">
                        {t('team.section.archived')}
                    </span>
                ) : null}
                {team.pendingDecisions > 0 ? (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        {t('dashboard.team.pending', { n: team.pendingDecisions })}
                    </span>
                ) : null}
                {team.requirements.missingConclusion > 0 ? (
                    <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                        {t('dashboard.team.missing', { n: team.requirements.missingConclusion })}
                    </span>
                ) : null}
                <span className="ml-auto shrink-0 text-[10px] text-[var(--app-hint)]">
                    {formatRelative(t, team.lastActivityAt)}
                </span>
            </header>

            <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-[var(--app-divider)] px-3 py-1.5 text-[11px] text-[var(--app-hint)]">
                <span>{t('dashboard.team.tasks', {
                    doing: team.tasks.doing,
                    todo: team.tasks.todo,
                    done: team.tasks.done,
                    blocked: team.tasks.blocked,
                })}</span>
                <span>{t('dashboard.team.requirements', {
                    open: team.requirements.open,
                    total: team.requirements.total,
                })}</span>
            </div>

            <div className="flex flex-col divide-y divide-[var(--app-divider)]">
                {team.members.length === 0 ? (
                    <div className="px-3 py-3 text-[11px] text-[var(--app-hint)]">{t('team.section.noMembers')}</div>
                ) : null}
                {team.members.map((member) => (
                    <MemberRow
                        key={member.sessionId}
                        member={member}
                        isLead={member.sessionId === team.leadSessionId}
                        onOpen={() => props.onOpenSession(member.sessionId)}
                    />
                ))}
            </div>
        </section>
    )
}

export function TeamOverviewPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { overview, isLoading, error, refetch } = useTeamOverview(api)

    const teams = overview?.teams ?? []
    const members = teams.flatMap((team) => team.members)
    const working = members.filter((member) => member.status === 'working').length
    const blocked = members.filter((member) => member.status === 'blocked').length
    const pendingDecisions = teams.reduce((sum, team) => sum + team.pendingDecisions, 0)
    const missingConclusions = teams.reduce((sum, team) => sum + team.requirements.missingConclusion, 0)

    return (
        <div className="app-scroll-y h-full min-h-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-content px-4 py-4">
                <header className="mb-4 flex items-start gap-3">
                    <button
                        type="button"
                        onClick={() => navigate({ to: '/sessions' })}
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        title={t('team.back')}
                        aria-label={t('team.back')}
                    >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m15 18-6-6 6-6" />
                        </svg>
                    </button>
                    <div className="min-w-0 flex-1">
                        <h1 className="text-lg font-semibold text-[var(--app-fg)]">{t('dashboard.title')}</h1>
                        <p className="mt-0.5 text-xs text-[var(--app-hint)]">{t('dashboard.subtitle')}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void refetch()}
                        className="shrink-0 rounded-lg border border-[var(--app-border)] px-2.5 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                    >
                        {t('dashboard.refresh')}
                    </button>
                </header>

                {error ? (
                    <div className="mb-3 rounded-lg border border-red-300/40 bg-red-500/5 px-3 py-2 text-xs text-red-600">
                        {t('dashboard.error')}: {error}
                    </div>
                ) : null}

                {isLoading && !overview ? (
                    <div className="py-8 text-center text-sm text-[var(--app-hint)]">{t('dashboard.loading')}</div>
                ) : teams.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--app-border)] px-4 py-10 text-center text-sm text-[var(--app-hint)]">
                        {t('dashboard.empty')}
                    </div>
                ) : (
                    <>
                        <div className="mb-4 grid grid-cols-2 gap-2 split:grid-cols-4">
                            <SummaryTile label={t('dashboard.summary.teams')} value={teams.length} />
                            <SummaryTile label={t('dashboard.summary.working')} value={working} accent="emerald" />
                            <SummaryTile label={t('dashboard.summary.decisions')} value={pendingDecisions} accent={pendingDecisions > 0 ? 'amber' : undefined} />
                            <SummaryTile label={t('dashboard.summary.missing')} value={missingConclusions} accent={missingConclusions > 0 ? 'amber' : undefined} />
                        </div>
                        {blocked > 0 ? (
                            <div className="mb-3 text-[11px] text-amber-600">
                                {t('dashboard.blockedMembers', { n: blocked })}
                            </div>
                        ) : null}
                        <div className="flex flex-col gap-3">
                            {teams.map((team) => (
                                <TeamCard
                                    key={team.id}
                                    team={team}
                                    onOpenTeam={() => navigate({
                                        to: '/sessions/teams/$teamId',
                                        params: { teamId: team.id },
                                    })}
                                    onOpenSession={(sessionId) => navigate({
                                        to: '/sessions/$sessionId',
                                        params: { sessionId },
                                    })}
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
