import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { TeamDialog } from './TeamDialog'

function machineLabel(machine: { id: string; metadata?: Record<string, unknown> | null }): string {
    const name = typeof machine.metadata?.name === 'string' ? machine.metadata.name.trim() : ''
    const host = typeof machine.metadata?.host === 'string' ? machine.metadata.host.trim() : ''
    return name || host || machine.id.slice(0, 8)
}

export function TeamCreateDialog(props: {
    open: boolean
    onClose: () => void
    onCreated: (teamId: string) => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { machines } = useMachines(api, props.open)
    const { spawnSession, isPending: spawning } = useSpawnSession(api)

    const [name, setName] = useState('')
    const [machineId, setMachineId] = useState('')
    const [directory, setDirectory] = useState('')
    const [agent, setAgent] = useState('claude')
    const [worktree, setWorktree] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const onlineMachines = useMemo(() => machines.filter((machine) => machine.active), [machines])

    useEffect(() => {
        if (!machineId && onlineMachines.length > 0) {
            setMachineId(onlineMachines[0]!.id)
        }
    }, [machineId, onlineMachines])

    useEffect(() => {
        if (!machineId || directory.trim()) return
        const machine = onlineMachines.find((candidate) => candidate.id === machineId)
        const root = machine?.metadata?.workspaceRoots?.[0]
        if (root) {
            setDirectory(root)
        }
    }, [machineId, onlineMachines, directory])

    const create = useMutation({
        mutationFn: async () => {
            if (!api) throw new Error('API unavailable')
            if (!machineId) throw new Error(t('team.create.needMachine'))
            if (!directory.trim()) throw new Error(t('team.create.needDirectory'))

            const spawned = await spawnSession({
                machineId,
                directory: directory.trim(),
                agent: agent as 'claude' | 'codex' | 'opencode' | 'pi',
                sessionType: worktree ? 'worktree' : 'simple',
            })
            if (spawned.type !== 'success') {
                throw new Error(spawned.message)
            }
            return await api.createTeam({
                name: name.trim(),
                leadSessionId: spawned.sessionId,
            })
        },
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.teams })
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
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

    const busy = create.isPending || spawning
    const canSubmit = name.trim().length > 0 && Boolean(machineId) && directory.trim().length > 0 && !busy

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
                        {busy ? t('team.create.creating') : t('team.create.submit')}
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
                <div className="grid grid-cols-2 gap-2">
                    <label className="flex min-w-0 flex-col gap-1">
                        <span className="text-xs text-[var(--app-hint)]">{t('team.create.machine')}</span>
                        <select
                            value={machineId}
                            onChange={(event) => setMachineId(event.target.value)}
                            className="min-w-0 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm text-[var(--app-fg)]"
                        >
                            {onlineMachines.length === 0 ? (
                                <option value="">{t('team.create.noMachines')}</option>
                            ) : null}
                            {onlineMachines.map((machine) => (
                                <option key={machine.id} value={machine.id}>{machineLabel(machine)}</option>
                            ))}
                        </select>
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                        <span className="text-xs text-[var(--app-hint)]">{t('team.create.agent')}</span>
                        <select
                            value={agent}
                            onChange={(event) => setAgent(event.target.value)}
                            className="min-w-0 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-2 text-sm text-[var(--app-fg)]"
                        >
                            <option value="claude">Claude</option>
                            <option value="codex">Codex</option>
                            <option value="opencode">OpenCode</option>
                            <option value="pi">Pi</option>
                        </select>
                    </label>
                </div>
                <label className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--app-hint)]">{t('team.create.directory')}</span>
                    <input
                        value={directory}
                        onChange={(event) => setDirectory(event.target.value)}
                        placeholder={t('team.create.directoryPlaceholder')}
                        className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 font-mono text-xs text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                    />
                    <span className="text-[11px] text-[var(--app-hint)]">{t('team.create.directoryHint')}</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-[var(--app-fg)]">
                    <input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} />
                    <span>{t('team.create.worktree')}</span>
                </label>
                {error ? <div className="text-xs text-red-600">{error}</div> : null}
            </div>
        </TeamDialog>
    )
}
