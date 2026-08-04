import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { CodexLocalSessionSummary, Machine } from '@/types/api'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SelectControl } from '@/components/ui/select-control'
import { markCodexSessionsImported } from '@/lib/codexImportedSessions'
import { useTranslation } from '@/lib/use-translation'
import { useCodexQuickImportPreferences } from '@/hooks/useCodexQuickImportPreferences'

const HOUR_MS = 60 * 60 * 1000
const LOAD_MORE_WINDOW_MS = 24 * HOUR_MS

function getMachineTitle(machine: Machine): string {
    return machine.metadata?.displayName
        || machine.metadata?.host
        || machine.id.slice(0, 8)
}

function getLastMachineId(): string | null {
    try {
        return localStorage.getItem('hapi:lastMachineId')
    } catch {
        return null
    }
}

function rememberMachineId(machineId: string): void {
    try {
        localStorage.setItem('hapi:lastMachineId', machineId)
    } catch {
        // Import still works when browser storage is unavailable.
    }
}

export function orderCodexQuickImportSessions(sessions: CodexLocalSessionSummary[]): CodexLocalSessionSummary[] {
    return [...sessions].sort((a, b) => {
        const importOrder = Number(Boolean(a.hapiSessionId)) - Number(Boolean(b.hapiSessionId))
        return importOrder || b.modifiedAt - a.modifiedAt
    })
}

function mergeCodexQuickImportSessions(
    current: CodexLocalSessionSummary[],
    incoming: CodexLocalSessionSummary[]
): CodexLocalSessionSummary[] {
    const merged = new Map(current.map((session) => [session.id, session]))
    for (const session of incoming) {
        const existing = merged.get(session.id)
        if (!existing || existing.modifiedAt < session.modifiedAt) merged.set(session.id, session)
    }
    return Array.from(merged.values())
}

export function CodexQuickImportDialog(props: {
    api: ApiClient
    machines: Machine[]
    isOpen: boolean
    onClose: () => void
    onImported: (hapiSessionId: string) => Promise<void> | void
}) {
    const { t } = useTranslation()
    const { preferences } = useCodexQuickImportPreferences()
    const activeMachines = useMemo(
        () => props.machines.filter((machine) => machine.active),
        [props.machines]
    )
    const [machineId, setMachineId] = useState<string | null>(null)
    const [sessions, setSessions] = useState<CodexLocalSessionSummary[]>([])
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [isImporting, setIsImporting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loadedSince, setLoadedSince] = useState<number | null>(null)
    const requestIdRef = useRef(0)

    const orderedSessions = useMemo(
        () => orderCodexQuickImportSessions(sessions),
        [sessions]
    )
    const filteredSessions = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) return orderedSessions
        return orderedSessions.filter((session) => (
            [session.title, session.lastUserMessage, session.cwd, session.id]
                .filter((value): value is string => typeof value === 'string')
                .some((value) => value.toLowerCase().includes(query))
        ))
    }, [orderedSessions, searchQuery])
    const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null

    const loadSessionRange = useCallback(async (options: {
        machineId: string
        modifiedSince: number
        modifiedBefore?: number
        append: boolean
    }) => {
        const requestId = ++requestIdRef.current
        if (options.append) setIsLoadingMore(true)
        else setIsLoading(true)
        setError(null)
        try {
            const result = await props.api.getCodexSessions(
                null,
                options.machineId,
                options.modifiedSince,
                options.modifiedBefore
            )
            if (!result.success) throw new Error(result.error)
            if (requestId !== requestIdRef.current) return
            setSessions((current) => options.append
                ? mergeCodexQuickImportSessions(current, result.sessions)
                : result.sessions)
            if (options.append) {
                setSelectedSessionId((current) => current ?? orderCodexQuickImportSessions(result.sessions)[0]?.id ?? null)
            } else {
                setSelectedSessionId((current) => {
                    if (current && result.sessions.some((session) => session.id === current)) return current
                    return orderCodexQuickImportSessions(result.sessions)[0]?.id ?? null
                })
            }
            setLoadedSince(options.modifiedSince)
        } catch (loadError) {
            if (requestId !== requestIdRef.current) return
            if (!options.append) {
                setSessions([])
                setSelectedSessionId(null)
                setLoadedSince(null)
            }
            setError(loadError instanceof Error ? loadError.message : t('codexSync.failed.body'))
        } finally {
            if (requestId === requestIdRef.current) {
                if (options.append) setIsLoadingMore(false)
                else setIsLoading(false)
            }
        }
    }, [props.api, t])

    const loadSessions = useCallback((nextMachineId: string) => {
        return loadSessionRange({
            machineId: nextMachineId,
            modifiedSince: Date.now() - preferences.initialHours * HOUR_MS,
            append: false
        })
    }, [loadSessionRange, preferences.initialHours])

    useEffect(() => {
        if (!props.isOpen) return
        setSearchQuery('')
        setError(null)
        const rememberedMachineId = getLastMachineId()
        const nextMachine = activeMachines.find((machine) => machine.id === machineId)
            ?? activeMachines.find((machine) => machine.id === rememberedMachineId)
            ?? activeMachines[0]
        setMachineId(nextMachine?.id ?? null)
    }, [activeMachines, machineId, props.isOpen])

    useEffect(() => {
        if (!props.isOpen || !machineId) return
        rememberMachineId(machineId)
        void loadSessions(machineId)
    }, [loadSessions, machineId, props.isOpen])

    const handleMachineChange = (nextMachineId: string) => {
        setMachineId(nextMachineId)
        setSessions([])
        setSelectedSessionId(null)
        setLoadedSince(null)
    }

    const handleLoadMore = () => {
        if (!machineId || loadedSince === null || isLoadingMore) return
        const nextModifiedSince = Math.max(0, loadedSince - LOAD_MORE_WINDOW_MS)
        void loadSessionRange({
            machineId,
            modifiedSince: nextModifiedSince,
            modifiedBefore: loadedSince,
            append: true
        })
    }

    const handleImport = async () => {
        if (!machineId || !selectedSession || isImporting) return
        setIsImporting(true)
        setError(null)
        try {
            const result = await props.api.syncCodexSession({
                sessionIds: [selectedSession.id],
                cwd: selectedSession.cwd ?? null,
                machineId
            })
            if (!result.success) throw new Error(result.error || t('codexSync.failed.body'))
            const hapiSessionId = result.hapiSessionIds?.[0] ?? selectedSession.hapiSessionId
            if (!hapiSessionId) throw new Error(t('codexSync.quick.missingSession'))

            markCodexSessionsImported([selectedSession.id])
            await props.onImported(hapiSessionId)
            props.onClose()
        } catch (importError) {
            setError(importError instanceof Error ? importError.message : t('codexSync.failed.body'))
        } finally {
            setIsImporting(false)
        }
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <AgentFlavorIcon flavor="codex" className="h-5 w-5" />
                        {t('codexSync.quick.title')}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {t('codexSync.quick.description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-3">
                    {activeMachines.length > 1 ? (
                        <label className="block text-xs font-medium text-[var(--app-hint)]">
                            <span className="mb-1 block">{t('codexSync.quick.machine')}</span>
                            <SelectControl
                                value={machineId ?? ''}
                                disabled={isImporting || isLoadingMore}
                                onChange={(event) => handleMachineChange(event.target.value)}
                                className="h-9 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] pl-2 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                            >
                                {activeMachines.map((machine) => (
                                    <option key={machine.id} value={machine.id}>{getMachineTitle(machine)}</option>
                                ))}
                            </SelectControl>
                        </label>
                    ) : null}

                    {sessions.length > 0 ? (
                        <label className="block">
                            <span className="sr-only">{t('codexSync.confirm.search')}</span>
                            <input
                                type="search"
                                value={searchQuery}
                                disabled={isLoading || isLoadingMore || isImporting}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder={t('codexSync.quick.searchPlaceholder')}
                                className="h-9 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                            />
                        </label>
                    ) : null}

                    {error ? (
                        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                            {error}
                        </div>
                    ) : null}

                    <div className="max-h-[52vh] overflow-y-auto rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
                        {activeMachines.length === 0 ? (
                            <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">
                                {t('codexSync.quick.noMachines')}
                            </div>
                        ) : isLoading ? (
                            <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">
                                {t('codexSync.confirm.loading')}
                            </div>
                        ) : sessions.length === 0 ? (
                            <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">
                                {t('codexSync.quick.empty', { hours: preferences.initialHours })}
                            </div>
                        ) : filteredSessions.length === 0 ? (
                            <div className="px-4 py-8 text-center text-sm text-[var(--app-hint)]">
                                {t('codexSync.quick.noResults')}
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--app-border)]">
                                {filteredSessions.map((session) => {
                                    const selected = session.id === selectedSessionId
                                    return (
                                        <button
                                            key={session.id}
                                            type="button"
                                            aria-pressed={selected}
                                            disabled={isImporting}
                                            onClick={() => setSelectedSessionId(session.id)}
                                            className={`flex w-full min-w-0 items-start gap-3 px-3 py-2 text-left transition-colors ${selected ? 'bg-[var(--app-subtle-bg)]' : 'hover:bg-[var(--app-subtle-bg)]'}`}
                                        >
                                            <span className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border ${selected ? 'border-[5px] border-[var(--app-link)]' : 'border-[var(--app-border)]'}`} />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--app-fg)]">{session.title}</span>
                                                    <span className={`shrink-0 text-[11px] ${session.hapiSessionId ? 'text-[var(--app-hint)]' : 'text-[var(--app-link)]'}`}>
                                                        {session.hapiSessionId ? t('codexSync.quick.imported') : t('codexSync.quick.notImported')}
                                                    </span>
                                                </span>
                                                {session.lastUserMessage ? (
                                                    <span className="mt-0.5 block truncate text-xs text-[var(--app-hint)]">{session.lastUserMessage}</span>
                                                ) : null}
                                                <span className="mt-0.5 flex min-w-0 gap-2 text-[11px] text-[var(--app-hint)]">
                                                    {session.cwd ? <span className="min-w-0 flex-1 truncate font-mono">{session.cwd}</span> : <span className="flex-1" />}
                                                    <span className="shrink-0">{new Date(session.modifiedAt).toLocaleString()}</span>
                                                </span>
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    {preferences.showLoadMore ? (
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={!machineId || loadedSince === null || loadedSince <= 0 || isLoading || isLoadingMore || isImporting}
                            onClick={handleLoadMore}
                        >
                            {isLoadingMore ? t('codexSync.quick.loadingMore') : t('codexSync.quick.loadMore')}
                        </Button>
                    ) : <span />}
                    <div className="ml-auto flex gap-2">
                        <Button type="button" variant="secondary" disabled={isImporting} onClick={props.onClose}>
                            {t('button.cancel')}
                        </Button>
                        <Button type="button" disabled={!selectedSession || isLoading || isLoadingMore || isImporting} onClick={() => void handleImport()}>
                            {isImporting
                                ? t('codexSync.quick.importing')
                                : selectedSession?.hapiSessionId
                                    ? t('codexSync.quick.syncAndOpen')
                                    : t('codexSync.quick.importAndOpen')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
