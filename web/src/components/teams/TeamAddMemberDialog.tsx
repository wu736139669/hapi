import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { TeamDialog } from './TeamDialog'

export function TeamAddMemberDialog(props: {
    open: boolean
    teamId: string
    leadSessionId: string | null
    onClose: () => void
    onSpawned: (role: string) => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [role, setRole] = useState('')
    const [task, setTask] = useState('')
    const [yolo, setYolo] = useState(false)
    const [agent, setAgent] = useState('')
    const [worktree, setWorktree] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const spawn = useMutation({
        mutationFn: async () => {
            if (!api) throw new Error('API unavailable')
            if (!props.leadSessionId) throw new Error(t('team.add.noLead'))
            return await api.spawnTeamMember(props.teamId, {
                fromSessionId: props.leadSessionId,
                role: role.trim(),
                task: task.trim() || undefined,
                yolo: yolo || undefined,
                agent: agent || undefined,
                sessionType: worktree ? 'worktree' : undefined,
            })
        },
        onSuccess: async (data) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.team(props.teamId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.teamMessages(props.teamId) }),
            ])
            setRole('')
            setTask('')
            setYolo(false)
            setAgent('')
            setWorktree(false)
            props.onSpawned(data.role)
        },
        onError: (mutationError) => {
            setError(mutationError instanceof Error ? mutationError.message : String(mutationError))
        },
    })

    const close = () => {
        setError(null)
        props.onClose()
    }

    const canSubmit = Boolean(props.leadSessionId) && role.trim().length > 0 && !spawn.isPending

    return (
        <TeamDialog
            open={props.open}
            title={t('team.add.title')}
            onClose={close}
            footer={
                <>
                    <button
                        type="button"
                        onClick={close}
                        className="rounded-lg border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                    >
                        {t('button.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={!canSubmit}
                        onClick={() => spawn.mutate()}
                        className="rounded-lg bg-[var(--app-fg)] px-3 py-1.5 text-sm font-medium text-[var(--app-bg)] disabled:opacity-40"
                    >
                        {spawn.isPending ? t('team.add.spawning') : t('team.add.submit')}
                    </button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                {!props.leadSessionId ? (
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20">
                        {t('team.add.noLead')}
                    </div>
                ) : null}
                <label className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--app-hint)]">{t('team.add.role')}</span>
                    <input
                        value={role}
                        onChange={(event) => setRole(event.target.value)}
                        placeholder={t('team.add.rolePlaceholder')}
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        autoFocus
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--app-hint)]">{t('team.add.task')}</span>
                    <textarea
                        value={task}
                        onChange={(event) => setTask(event.target.value)}
                        rows={3}
                        placeholder={t('team.add.taskPlaceholder')}
                        className="resize-none rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--app-hint)]">{t('team.add.agent')}</span>
                    <select
                        value={agent}
                        onChange={(event) => setAgent(event.target.value)}
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)]"
                    >
                        <option value="">{t('team.add.agentDefault')}</option>
                        <option value="claude">Claude</option>
                        <option value="codex">Codex</option>
                        <option value="opencode">OpenCode</option>
                        <option value="pi">Pi</option>
                    </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-[var(--app-fg)]">
                    <input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} />
                    <span>{t('team.add.worktree')}</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-[var(--app-fg)]">
                    <input type="checkbox" checked={yolo} onChange={(event) => setYolo(event.target.checked)} />
                    <span>{t('team.add.yolo')}</span>
                </label>
                {error ? <div className="text-xs text-red-600">{error}</div> : null}
            </div>
        </TeamDialog>
    )
}
