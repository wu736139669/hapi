import type { TeamSummary } from '@/types/team'
import { useTranslation } from '@/lib/use-translation'

/**
 * Sidebar section listing Agent Teams. Renders nothing when the hub has the
 * feature disabled (no teams) so the sessions list is unchanged.
 */
export function TeamSidebarSection(props: {
    teams: TeamSummary[]
    selectedTeamId?: string | null
    onSelectTeam: (teamId: string) => void
}) {
    const { t } = useTranslation()
    // Teams are created from the New Session form (session type: Team); an
    // empty section would just be noise.
    if (props.teams.length === 0) {
        return null
    }

    return (
        <div className="mb-1">
            <div className="flex items-center justify-between px-3 py-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                    {t('team.section.title')}
                </span>
            </div>
            <div className="flex flex-col gap-0.5">
                {props.teams.map((team) => (
                    <button
                        key={team.id}
                        type="button"
                        onClick={() => props.onSelectTeam(team.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                            props.selectedTeamId === team.id
                                ? 'bg-[var(--app-subtle-bg)] text-[var(--app-fg)]'
                                : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]'
                        }`}
                    >
                        <svg className="h-4 w-4 shrink-0 text-[var(--app-hint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        <span className="min-w-0 truncate">{team.name}</span>
                        {team.status !== 'active' ? (
                            <span className="shrink-0 text-[10px] text-[var(--app-hint)]">{t('team.section.archived')}</span>
                        ) : null}
                    </button>
                ))}
            </div>
        </div>
    )
}
