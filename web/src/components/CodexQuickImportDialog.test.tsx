import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { CodexLocalSessionSummary, Machine } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { CODEX_QUICK_IMPORT_PREFERENCES_STORAGE_KEY } from '@/hooks/useCodexQuickImportPreferences'
import { CodexQuickImportDialog, orderCodexQuickImportSessions } from './CodexQuickImportDialog'

function makeMachine(): Machine {
    return {
        id: 'machine-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: {
            host: 'workstation.local',
            platform: 'linux',
            happyCliVersion: '1.0.0'
        },
        metadataVersion: 1,
        runnerState: null,
        runnerStateVersion: 1
    }
}

function makeSession(overrides: Partial<CodexLocalSessionSummary>): CodexLocalSessionSummary {
    return {
        id: 'codex-session',
        title: 'Codex session',
        cwd: '/work/project',
        file: '/home/user/.codex/sessions/session.jsonl',
        modifiedAt: 100,
        ...overrides
    }
}

describe('CodexQuickImportDialog', () => {
    afterEach(() => {
        cleanup()
        window.localStorage.clear()
        vi.clearAllMocks()
    })

    it('orders unimported sessions before newer imported sessions', () => {
        const sessions = orderCodexQuickImportSessions([
            makeSession({ id: 'imported', modifiedAt: 200, hapiSessionId: 'hapi-session' }),
            makeSession({ id: 'new', modifiedAt: 100 })
        ])

        expect(sessions.map((session) => session.id)).toEqual(['new', 'imported'])
    })

    it('imports the latest unimported session on its source machine and opens it', async () => {
        const openedAt = Date.now()
        const getCodexSessions = vi.fn(async (
            _cwd?: string | null,
            _machineId?: string | null,
            _modifiedSince?: number,
            _modifiedBefore?: number
        ) => ({
            success: true as const,
            machineId: 'machine-1',
            sessions: [
                makeSession({ id: 'imported', title: 'Imported session', modifiedAt: 300, hapiSessionId: 'hapi-existing' }),
                makeSession({ id: 'new-session', title: 'New managed session', modifiedAt: 200 })
            ]
        }))
        const syncCodexSession = vi.fn(async () => ({
            success: true,
            hapiSessionIds: ['hapi-new']
        }))
        const onImported = vi.fn(async () => {})
        const onClose = vi.fn()
        const api = { getCodexSessions, syncCodexSession } as unknown as ApiClient

        render(
            <I18nProvider>
                <CodexQuickImportDialog
                    api={api}
                    machines={[makeMachine()]}
                    isOpen={true}
                    onClose={onClose}
                    onImported={onImported}
                />
            </I18nProvider>
        )

        await screen.findByText('New managed session')
        expect(getCodexSessions).toHaveBeenCalledWith(null, 'machine-1', expect.any(Number), undefined)
        const modifiedSince = getCodexSessions.mock.calls[0]?.[2]
        expect(modifiedSince).toBeGreaterThanOrEqual(openedAt - 5 * 60 * 60 * 1000)
        expect(modifiedSince).toBeLessThanOrEqual(Date.now() - 5 * 60 * 60 * 1000)
        fireEvent.click(screen.getByRole('button', { name: 'Import and open' }))

        await waitFor(() => {
            expect(syncCodexSession).toHaveBeenCalledWith({
                sessionIds: ['new-session'],
                cwd: '/work/project',
                machineId: 'machine-1'
            })
            expect(onImported).toHaveBeenCalledWith('hapi-new')
            expect(onClose).toHaveBeenCalledTimes(1)
        })
    })

    it('loads the previous day as a non-overlapping range', async () => {
        let requestCount = 0
        const getCodexSessions = vi.fn(async (
            _cwd?: string | null,
            _machineId?: string | null,
            _modifiedSince?: number,
            _modifiedBefore?: number
        ) => {
            requestCount += 1
            return {
                success: true as const,
                machineId: 'machine-1',
                sessions: requestCount === 1
                    ? [makeSession({ id: 'recent', title: 'Recent session', modifiedAt: 300 })]
                    : [makeSession({ id: 'older', title: 'Older session', modifiedAt: 200 })]
            }
        })
        const api = { getCodexSessions } as unknown as ApiClient

        render(
            <I18nProvider>
                <CodexQuickImportDialog
                    api={api}
                    machines={[makeMachine()]}
                    isOpen={true}
                    onClose={vi.fn()}
                    onImported={vi.fn()}
                />
            </I18nProvider>
        )

        await screen.findByText('Recent session')
        const initialSince = getCodexSessions.mock.calls[0]?.[2] as number
        fireEvent.click(screen.getByRole('button', { name: 'Load previous day' }))

        await screen.findByText('Older session')
        expect(getCodexSessions).toHaveBeenNthCalledWith(
            2,
            null,
            'machine-1',
            initialSince - 24 * 60 * 60 * 1000,
            initialSince
        )
        expect(screen.getByText('Recent session')).toBeInTheDocument()
    })

    it('uses configured hours and hides load more when disabled', async () => {
        window.localStorage.setItem(CODEX_QUICK_IMPORT_PREFERENCES_STORAGE_KEY, JSON.stringify({
            initialHours: 8,
            showLoadMore: false
        }))
        const openedAt = Date.now()
        const getCodexSessions = vi.fn(async (
            _cwd?: string | null,
            _machineId?: string | null,
            _modifiedSince?: number,
            _modifiedBefore?: number
        ) => ({
            success: true as const,
            machineId: 'machine-1',
            sessions: [makeSession({ title: 'Configured session' })]
        }))
        const api = { getCodexSessions } as unknown as ApiClient

        render(
            <I18nProvider>
                <CodexQuickImportDialog
                    api={api}
                    machines={[makeMachine()]}
                    isOpen={true}
                    onClose={vi.fn()}
                    onImported={vi.fn()}
                />
            </I18nProvider>
        )

        await screen.findByText('Configured session')
        const modifiedSince = getCodexSessions.mock.calls[0]?.[2] as number
        expect(modifiedSince).toBeGreaterThanOrEqual(openedAt - 8 * 60 * 60 * 1000)
        expect(modifiedSince).toBeLessThanOrEqual(Date.now() - 8 * 60 * 60 * 1000)
        expect(screen.queryByRole('button', { name: 'Load previous day' })).not.toBeInTheDocument()
    })
})
