import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TeamSummary } from '@/types/team'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { TeamDialog } from './TeamDialog'

export function TeamSettingsDialog(props: {
    open: boolean
    team: TeamSummary | null
    onClose: () => void
    onChanged: (patch: { status?: 'active' | 'archived' }) => void
    onDeleted: () => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [name, setName] = useState('')
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (props.team) {
            setName(props.team.name)
            setConfirmDelete(false)
            setError(null)
        }
    }, [props.team])

    const rename = useMutation({
        mutationFn: async () => {
            if (!api || !props.team) throw new Error('API unavailable')
            return await api.updateTeam(props.team.id, { name: name.trim() })
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.teams })
            if (props.team) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.team(props.team.id) })
            }
            props.onClose()
        },
        onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : String(mutationError)),
    })

    const setStatus = useMutation({
        mutationFn: async (status: 'active' | 'archived') => {
            if (!api || !props.team) throw new Error('API unavailable')
            return await api.updateTeam(props.team.id, { status })
        },
        onSuccess: async (_data, status) => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.teams })
            if (props.team) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.team(props.team.id) })
            }
            props.onChanged({ status })
            props.onClose()
        },
        onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : String(mutationError)),
    })

    const remove = useMutation({
        mutationFn: async () => {
            if (!api || !props.team) throw new Error('API unavailable')
            return await api.deleteTeam(props.team.id)
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.teams })
            props.onDeleted()
        },
        onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : String(mutationError)),
    })

    const busy = rename.isPending || setStatus.isPending || remove.isPending
    const archived = props.team?.status === 'archived'

    return (
        <TeamDialog
            open={props.open}
            title={t('team.settings.title')}
            onClose={props.onClose}
            footer={
                <>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="rounded-lg border border-[var(--app-border)] px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                    >
                        {t('button.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={busy || name.trim().length === 0 || name.trim() === props.team?.name}
                        onClick={() => rename.mutate()}
                        className="rounded-lg bg-[var(--app-fg)] px-3 py-1.5 text-sm font-medium text-[var(--app-bg)] disabled:opacity-40"
                    >
                        {t('team.settings.rename')}
                    </button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--app-hint)]">{t('team.create.name')}</span>
                    <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                    />
                </label>

                <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStatus.mutate(archived ? 'active' : 'archived')}
                    className="rounded-lg border border-[var(--app-border)] px-3 py-2 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40"
                >
                    {archived ? t('team.settings.unarchive') : t('team.settings.archive')}
                </button>

                <div className="border-t border-[var(--app-divider)] pt-2">
                    {confirmDelete ? (
                        <div className="flex flex-col gap-2">
                            <div className="text-xs text-red-600">{t('team.settings.deleteConfirm')}</div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => remove.mutate()}
                                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                                >
                                    {t('team.settings.deleteConfirmYes')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmDelete(false)}
                                    className="rounded-lg border border-[var(--app-border)] px-3 py-1.5 text-xs text-[var(--app-fg)]"
                                >
                                    {t('button.cancel')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setConfirmDelete(true)}
                            className="text-xs text-red-600 hover:underline"
                        >
                            {t('team.settings.delete')}
                        </button>
                    )}
                </div>

                {error ? <div className="text-xs text-red-600">{error}</div> : null}
            </div>
        </TeamDialog>
    )
}
