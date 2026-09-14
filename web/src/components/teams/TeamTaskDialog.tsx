import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TeamDetail, TeamTask, TeamTaskStatus } from '@/types/team'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { TeamDialog } from './TeamDialog'
import { memberStatusLabel } from './teamStatus'

const STATUSES: TeamTaskStatus[] = ['todo', 'doing', 'done', 'blocked']

export function TeamTaskDialog(props: {
    open: boolean
    teamId: string
    task: TeamTask | null
    members: TeamDetail['members']
    onClose: () => void
    onViewTimeline: (taskId: string) => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [status, setStatus] = useState<TeamTaskStatus>('todo')
    const [assignee, setAssignee] = useState<string>('')
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (props.task) {
            setStatus(props.task.status)
            setAssignee(props.task.assigneeSessionId ?? '')
            setError(null)
        }
    }, [props.task])

    const save = useMutation({
        mutationFn: async () => {
            if (!api || !props.task) throw new Error('API unavailable')
            return await api.updateTeamTask(props.teamId, props.task.id, {
                status,
                assigneeSessionId: assignee || null,
            })
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.team(props.teamId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.teamMessages(props.teamId) }),
            ])
            props.onClose()
        },
        onError: (mutationError) => {
            setError(mutationError instanceof Error ? mutationError.message : String(mutationError))
        },
    })

    return (
        <TeamDialog
            open={props.open}
            title={props.task?.title ?? ''}
            onClose={props.onClose}
            footer={
                <>
                    <button
                        type="button"
                        onClick={() => {
                            if (props.task) props.onViewTimeline(props.task.id)
                        }}
                        className="mr-auto rounded-lg border border-[var(--app-border)] px-3 py-1.5 text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                    >
                        {t('team.task.viewTimeline')}
                    </button>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="rounded-lg border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                    >
                        {t('button.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={save.isPending}
                        onClick={() => save.mutate()}
                        className="rounded-lg bg-[var(--app-fg)] px-3 py-1.5 text-sm font-medium text-[var(--app-bg)] disabled:opacity-40"
                    >
                        {save.isPending ? t('team.task.saving') : t('team.task.save')}
                    </button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--app-hint)]">{t('team.task.status')}</span>
                    <select
                        value={status}
                        onChange={(event) => setStatus(event.target.value as TeamTaskStatus)}
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)]"
                    >
                        {STATUSES.map((value) => (
                            <option key={value} value={value}>
                                {t(`team.task.statusLabel.${value}`)}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--app-hint)]">{t('team.task.assignee')}</span>
                    <select
                        value={assignee}
                        onChange={(event) => setAssignee(event.target.value)}
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)]"
                    >
                        <option value="">{t('team.panel.unassigned')}</option>
                        {props.members.map((member) => (
                            <option key={member.sessionId} value={member.sessionId}>
                                {member.role} · {memberStatusLabel(t, member.status)}
                            </option>
                        ))}
                    </select>
                </label>
                {error ? <div className="text-xs text-red-600">{error}</div> : null}
            </div>
        </TeamDialog>
    )
}
