import type { TeamMemberStatus } from '@/types/team'

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string

export function statusDotClass(status: TeamMemberStatus): string {
    if (status === 'working') return 'bg-emerald-500'
    if (status === 'blocked') return 'bg-amber-500'
    if (status === 'offline') return 'bg-gray-400'
    return 'bg-[var(--app-hint)]'
}

export function memberStatusLabel(t: TranslateFn, status: TeamMemberStatus): string {
    if (status === 'working') return t('team.status.working')
    if (status === 'blocked') return t('team.status.blocked')
    if (status === 'offline') return t('team.status.offline')
    return t('team.status.idle')
}
