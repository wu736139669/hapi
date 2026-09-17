import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { Store, type StoredMachine } from '../../../store'
import type { CliSocketWithData } from '../../socketTypes'
import { registerMachineHandlers } from './machineHandlers'

function harness(options: { access: 'ok' | 'denied' }) {
    const socket = new EventEmitter() as unknown as CliSocketWithData
    const store = new Store(':memory:')
    const accessErrors: Array<{ scope: string; id: string; reason: string }> = []

    registerMachineHandlers(socket, {
        store,
        resolveMachineAccess: () => (
            options.access === 'ok'
                ? { ok: true, value: { namespace: 'default' } as unknown as StoredMachine }
                : { ok: false, reason: 'access-denied' }
        ),
        emitAccessError: (scope, id, reason) => { accessErrors.push({ scope, id, reason }) }
    })

    return { socket: socket as unknown as EventEmitter, store, accessErrors }
}

const row = {
    day: '2026-09-17',
    model: 'opencode-go/deepseek-v4.1-flash',
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 80,
    cacheCreationTokens: 0,
    requests: 2
}

describe('opencode-usage-report', () => {
    it('replaces the matching session snapshot by OpenCode session id', () => {
        const { socket, store } = harness({ access: 'ok' })
        const session = store.sessions.getOrCreateSession(
            'opencode-machine-report',
            { path: '/tmp', host: 'k2lab', flavor: 'opencode', opencodeSessionId: 'ses_a' },
            null,
            'default'
        )

        socket.emit('opencode-usage-report', {
            machineId: 'machine-1',
            sessions: [{ opencodeSessionId: 'ses_a', rows: [row] }]
        })

        expect(store.usage.getReconciledByNamespace('default')).toEqual([
            expect.objectContaining({ sessionId: session.id, day: '2026-09-17', requests: 2 })
        ])
    })

    it('ignores reports for machines without access', () => {
        const { socket, store, accessErrors } = harness({ access: 'denied' })

        socket.emit('opencode-usage-report', {
            machineId: 'someone-elses-machine',
            sessions: [{ opencodeSessionId: 'ses_a', rows: [row] }]
        })

        expect(store.usage.getReconciledByNamespace('default')).toHaveLength(0)
        expect(accessErrors).toEqual([
            { scope: 'machine', id: 'someone-elses-machine', reason: 'access-denied' }
        ])
    })

    it('skips unknown session ids and empty row sets without touching snapshots', () => {
        const { socket, store } = harness({ access: 'ok' })
        const session = store.sessions.getOrCreateSession(
            'opencode-machine-report-known',
            { path: '/tmp', host: 'k2lab', flavor: 'opencode', opencodeSessionId: 'ses_known' },
            null,
            'default'
        )
        store.usage.replaceReconciled(session.id, 'default', [
            { ...row, sessionId: session.id, agent: 'opencode' }
        ], Date.now())

        socket.emit('opencode-usage-report', {
            machineId: 'machine-1',
            sessions: [
                { opencodeSessionId: 'ses_unknown', rows: [row] },
                { opencodeSessionId: 'ses_known', rows: [] }
            ]
        })

        expect(store.usage.getReconciledByNamespace('default')).toEqual([
            expect.objectContaining({ sessionId: session.id, requests: 2 })
        ])
    })

    it('drops malformed payloads without erroring', () => {
        const { socket, store, accessErrors } = harness({ access: 'ok' })

        socket.emit('opencode-usage-report', {})
        socket.emit('opencode-usage-report', null)
        socket.emit('opencode-usage-report', {
            machineId: 'machine-1',
            sessions: [{ opencodeSessionId: 'ses_a', rows: [{ day: 'nope' }] }]
        })

        expect(store.usage.getReconciledByNamespace('default')).toHaveLength(0)
        expect(accessErrors).toEqual([])
    })
})
