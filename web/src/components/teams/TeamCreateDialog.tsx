import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { TeamDialog } from './TeamDialog'

function sessionLabel(session: SessionSummary): string {
    const name = session.metadata?.name?.trim()
    if (name) return name
    const path = session.metadata?.path ?? ''
    const base = path.split('/').filter(Boolean).pop()
    return base ?? session.id.slice(0, 8)
}

export function TeamCreateDialog(props: {
    open: boolean
    sessions: SessionSummary[]
    onClose: () => void
    onCreated: (teamId: string) => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [name, setName] = useState('')
    const [leadSessionId, setLeadSessionId] = useState('')
    const [error, setError] = useState<string | null>(null)

    const create = useMutation({
        mutationFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.createTeam({
                name: name.trim(),
                leadSessionId: leadSessionId || undefined,
            })
        },
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.teams })
            props.onCreated(data.team.id)
        },
        onError: (mutationError) => {
            setError(mutationError instanceof Error ? mutationError.message : String(mutationError))
        },
    })

    const close = () => {
        setError(null)
        props.onClose()
    }

    const canSubmit = name.trim().length > 0 && !create.isPending

    return (
        <TeamDialog
            open={props.open}
            title={t('team.create.title')}
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
                        onClick={() => create.mutate()}
                        className="rounded-lg bg-[var(--app-fg)] px-3 py-1.5 text-sm font-medium text-[var(--app-bg)] disabled:opacity-40"
                    >
                        {create.isPending ? t('team.create.creating') : t('team.create.submit')}
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
                        placeholder={t('team.create.namePlaceholder')}
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        autoFocus
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--app-hint)]">{t('team.create.lead')}</span>
                    {props.sessions.length === 0 ? (
                        <span className="text-xs text-amber-600">{t('team.create.noSessions')}</span>
                    ) : (
                        <select
                            value={leadSessionId}
                            onChange={(event) => setLeadSessionId(event.target.value)}
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)]"
                        >
                            <option value="">{t('team.create.leadNone')}</option>
                            {props.sessions.map((session) => (
                                <option key={session.id} value={session.id}>
                                    {sessionLabel(session)}
                                </option>
                            ))}
                        </select>
                    )}
                    <span className="text-[11px] text-[var(--app-hint)]">{t('team.create.leadHint')}</span>
                </label>
                {error ? <div className="text-xs text-red-600">{error}</div> : null}
            </div>
        </TeamDialog>
    )
}
