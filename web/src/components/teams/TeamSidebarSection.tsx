import { useEffect, useState } from 'react'
import type { SessionSummary } from '@/types/api'
import type { TeamWithMembers } from '@/types/team'
import { useTranslation } from '@/lib/use-translation'
import { memberStatusLabel, statusDotClass } from './teamStatus'

function sessionLabel(session: SessionSummary | undefined, fallbackId: string): string {
    const name = session?.metadata?.name?.trim()
    if (name) return name
    const path = session?.metadata?.path ?? ''
    const base = path.split('/').filter(Boolean).pop()
    return base ?? fallbackId.slice(0, 8)
}

/**
 * Sidebar section listing Agent Teams. Member sessions are nested under their
 * team (and filtered out of the regular session list) so a team's sessions do
 * not scatter across the sidebar. Renders nothing when there are no teams.
 */
export function TeamSidebarSection(props: {
    teams: TeamWithMembers[]
    sessions: SessionSummary[]
    selectedTeamId?: string | null
    selectedSessionId?: string | null
    onSelectTeam: (teamId: string) => void
    onSelectSession: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState<Set<string>>(new Set())

    // Keep the active team unfolded so its members are reachable.
    useEffect(() => {
        if (!props.selectedTeamId) return
        setExpanded((current) => {
            if (current.has(props.selectedTeamId!)) return current
            const next = new Set(current)
            next.add(props.selectedTeamId!)
            return next
        })
    }, [props.selectedTeamId])

    if (props.teams.length === 0) {
        return null
    }

    const sessionsById = new Map(props.sessions.map((session) => [session.id, session]))

    return (
        <div className="mb-1">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                {t('team.section.title')}
            </div>
            <div className="flex flex-col gap-0.5">
                {props.teams.map((team) => {
                    const isExpanded = expanded.has(team.id)
                    return (
                        <div key={team.id}>
                            <div
                                className={`flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                                    props.selectedTeamId === team.id
                                        ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                }`}
                            >
                                <button
                                    type="button"
                                    onClick={() => setExpanded((current) => {
                                        const next = new Set(current)
                                        if (next.has(team.id)) {
                                            next.delete(team.id)
                                        } else {
                                            next.add(team.id)
                                        }
                                        return next
                                    })}
                                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                                    aria-label={isExpanded ? t('team.thread.collapse') : t('team.thread.expand')}
                                >
                                    <svg
                                        className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                    >
                                        <path d="m9 18 6-6-6-6" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => props.onSelectTeam(team.id)}
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                >
                                    <svg className="h-4 w-4 shrink-0 text-[var(--app-hint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                                        <circle cx="9" cy="7" r="4" />
                                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                    </svg>
                                    <span className="min-w-0 truncate">{team.name}</span>
                                    <span className="shrink-0 text-[10px] text-[var(--app-hint)]">
                                        {t('team.section.members', { n: team.members.length })}
                                    </span>
                                    {team.status !== 'active' ? (
                                        <span className="shrink-0 text-[10px] text-[var(--app-hint)]">{t('team.section.archived')}</span>
                                    ) : null}
                                </button>
                            </div>
                            {isExpanded ? (
                                <div className="ml-4 flex flex-col gap-0.5 border-l border-[var(--app-divider)] pl-2">
                                    {team.members.length === 0 ? (
                                        <div className="px-2 py-1 text-[11px] text-[var(--app-hint)]">{t('team.section.noMembers')}</div>
                                    ) : null}
                                    {team.members.map((member) => {
                                        const session = sessionsById.get(member.sessionId)
                                        const status = !session
                                            ? 'offline' as const
                                            : !session.active
                                                ? 'offline' as const
                                                : session.thinking
                                                    ? 'working' as const
                                                    : member.status === 'blocked'
                                                        ? 'blocked' as const
                                                        : 'idle' as const
                                        return (
                                            <button
                                                key={member.sessionId}
                                                type="button"
                                                onClick={() => props.onSelectSession(member.sessionId)}
                                                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors ${
                                                    props.selectedSessionId === member.sessionId
                                                        ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
                                                        : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                                                }`}
                                            >
                                                <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(status)}`} />
                                                <span className="shrink-0 text-[11px] text-[var(--app-hint)]">{member.role}</span>
                                                <span className="min-w-0 truncate">{sessionLabel(session, member.sessionId)}</span>
                                                <span className="ml-auto shrink-0 text-[10px] text-[var(--app-hint)]">
                                                    {memberStatusLabel(t, status)}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            ) : null}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
