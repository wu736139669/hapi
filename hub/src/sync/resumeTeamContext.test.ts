import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

function createEngine(store: Store): SyncEngine {
    const engine = new SyncEngine(
        store,
        {} as never,
        new RpcRegistry(),
        { broadcast() {} } as never
    )
    engine.stop()
    return engine
}

describe('team context survives resume', () => {
    it('re-attaches the team payload (including token) on resume', async () => {
        const store = new Store(':memory:')
        const engine = createEngine(store)

        const machine = engine.getOrCreateMachine(
            'machine-team-resume',
            { host: 'localhost', platform: 'linux', happyCliVersion: '0.1.0' },
            null,
            'default'
        )
        engine.handleMachineAlive({ machineId: machine.id, time: Date.now() })

        const session = engine.getOrCreateSession(
            'resume-team-session',
            {
                path: '/tmp/project',
                host: 'localhost',
                machineId: machine.id,
                flavor: 'codex',
                codexSessionId: 'resume-token'
            },
            { requests: {}, completedRequests: {} },
            'default'
        )
        engine.handleSessionAlive({
            sid: session.id,
            time: Date.now(),
            permissionMode: 'yolo'
        })
        engine.handleSessionEnd({ sid: session.id, time: Date.now() })

        // Fresh engine = hub restart; membership lives in TeamService.
        const restartedEngine = createEngine(store)
        restartedEngine.handleMachineAlive({ machineId: machine.id, time: Date.now() })
        restartedEngine.setTeamContextResolver((sessionId) =>
            sessionId === session.id
                ? { id: 'team-1', name: 'Team One', role: 'lead', token: 'hapi_team_abc123' }
                : null
        )

        let capturedTeam: unknown
        ;(restartedEngine as any).rpcGateway.spawnSession = async (
            _machineId: string,
            _directory: string,
            _agent: string,
            _model?: string,
            _modelReasoningEffort?: string,
            _yolo?: boolean,
            _sessionType?: string,
            _worktreeName?: string,
            _resumeSessionId?: string,
            _effort?: string,
            permissionMode?: string,
            _serviceTier?: string,
            _existingSessionId?: string,
            _collaborationMode?: string,
            _copilotAgentMode?: string,
            _startingMode?: string,
            _forkSession?: boolean,
            _reservedSessionId?: string,
            team?: unknown
        ) => {
            capturedTeam = team
            restartedEngine.handleSessionAlive({
                sid: session.id,
                time: Date.now(),
                permissionMode: permissionMode as never
            })
            return { type: 'success', sessionId: session.id }
        }
        ;(restartedEngine as any).waitForSessionActive = async () => true

        const result = await restartedEngine.resumeSession(session.id, 'default')

        expect(result).toEqual({ type: 'success', sessionId: session.id })
        expect(capturedTeam).toEqual({
            id: 'team-1',
            name: 'Team One',
            role: 'lead',
            token: 'hapi_team_abc123'
        })
    })

    it('omits the team payload for sessions that are not on a team', async () => {
        const store = new Store(':memory:')
        const engine = createEngine(store)

        const machine = engine.getOrCreateMachine(
            'machine-no-team',
            { host: 'localhost', platform: 'linux', happyCliVersion: '0.1.0' },
            null,
            'default'
        )
        engine.handleMachineAlive({ machineId: machine.id, time: Date.now() })

        const session = engine.getOrCreateSession(
            'resume-no-team-session',
            {
                path: '/tmp/project',
                host: 'localhost',
                machineId: machine.id,
                flavor: 'codex',
                codexSessionId: 'resume-token'
            },
            { requests: {}, completedRequests: {} },
            'default'
        )
        engine.handleSessionAlive({ sid: session.id, time: Date.now() })
        engine.handleSessionEnd({ sid: session.id, time: Date.now() })

        const restartedEngine = createEngine(store)
        restartedEngine.handleMachineAlive({ machineId: machine.id, time: Date.now() })
        restartedEngine.setTeamContextResolver(() => null)

        let capturedTeam: unknown = 'unset'
        ;(restartedEngine as any).rpcGateway.spawnSession = async (...args: unknown[]) => {
            capturedTeam = args[18]
            restartedEngine.handleSessionAlive({ sid: session.id, time: Date.now() })
            return { type: 'success', sessionId: session.id }
        }
        ;(restartedEngine as any).waitForSessionActive = async () => true

        const result = await restartedEngine.resumeSession(session.id, 'default')

        expect(result).toEqual({ type: 'success', sessionId: session.id })
        expect(capturedTeam).toBeUndefined()
    })
})
