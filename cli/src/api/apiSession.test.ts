import { describe, expect, it, vi } from 'vitest'
import type { Session } from './types'

const socketHarness = vi.hoisted(() => ({
    sockets: [] as Array<{
        connected: boolean
        connectCalls: number
        connectImmediately: boolean
        ack: (event: string, ...args: unknown[]) => Promise<unknown>
        emitted: Array<{ event: string; args: unknown[] }>
        listeners: Map<string, Array<(...args: any[]) => void>>
        trigger: (event: string, ...args: any[]) => void
        triggerConnect: () => void
        triggerConnectError: () => void
    }>
}))

const axiosHarness = vi.hoisted(() => ({
    get: vi.fn()
}))

vi.mock('socket.io-client', () => ({
    io: () => {
        const state: (typeof socketHarness.sockets)[number] = {
            connected: false,
            connectCalls: 0,
            connectImmediately: true,
            ack: async () => ({}),
            emitted: [] as Array<{ event: string; args: unknown[] }>,
            listeners: new Map<string, Array<(...args: any[]) => void>>(),
            trigger: () => {},
            triggerConnect: () => {},
            triggerConnectError: () => {}
        }
        state.trigger = (event: string, ...args: any[]) => {
            for (const listener of state.listeners.get(event) ?? []) {
                listener(...args)
            }
        }
        const triggerConnect = () => {
            state.connected = true
            state.trigger('connect')
        }
        state.triggerConnect = triggerConnect
        state.triggerConnectError = () => {
            state.trigger('connect_error', new Error('connect failed'))
        }
        const socket = {
            get connected() {
                return state.connected
            },
            on: (event: string, listener: (...args: any[]) => void) => {
                const listeners = state.listeners.get(event) ?? []
                listeners.push(listener)
                state.listeners.set(event, listeners)
                return socket
            },
            off: (event: string, listener: (...args: any[]) => void) => {
                const listeners = state.listeners.get(event) ?? []
                state.listeners.set(event, listeners.filter((candidate) => candidate !== listener))
                return socket
            },
            emit: (event: string, ...args: unknown[]) => {
                state.emitted.push({ event, args })
                return socket
            },
            emitWithAck: (event: string, ...args: unknown[]) => state.ack(event, ...args),
            timeout: () => ({ emitWithAck: (event: string, ...args: unknown[]) => state.ack(event, ...args) }),
            connect: () => {
                state.connectCalls += 1
                if (state.connectImmediately) {
                    triggerConnect()
                }
                return socket
            },
            disconnect: () => {
                state.connected = false
                return socket
            }
        }
        Object.assign(socket, { volatile: socket })
        socketHarness.sockets.push(state)
        return socket
    }
}))

vi.mock('axios', () => ({
    default: {
        get: axiosHarness.get,
        isAxiosError: (error: unknown) => (
            typeof error === 'object'
            && error !== null
            && 'isAxiosError' in error
            && error.isAxiosError === true
        )
    }
}))

import { ApiSessionClient, isExternalUserMessage, IncomingMessageFilter } from './apiSession'

describe('ApiSessionClient confirmed Codex transcripts', () => {
    it('preserves native history times, validates durable progress, and trims agent output before upload', async () => {
        const client = new ApiSessionClient('token', createSession({
            metadata: { path: '/repo', host: 'test', capabilities: { concurrentClients: true } }
        }))
        const socket = socketHarness.sockets.at(-1)!
        const payloads: Array<{ message: { content: { data?: { message: string }; text?: string } }; createdAt?: number }> = []
        socket.ack = async (event, data) => {
            if (event === 'codex-history-sync') return { ok: true, state: { epoch: 0, revision: 1, checkpoint: null } }
            if (event === 'message') payloads.push(data as typeof payloads[number])
            return { ok: true }
        }
        client.sendAgentMessage({ type: 'message', message: 'x'.repeat(1024 * 1024) }, 'large', { replay: true, createdAt: 1000 })
        client.sendUserMessage('u'.repeat(100_000), undefined, 'user', { replay: true, createdAt: 2000 })
        expect(await client.waitForMessages(['large', 'user'])).toBe(true)
        expect(payloads.map(payload => payload.createdAt)).toEqual([1000, 2000])
        expect(payloads[0].message.content.data?.message.length).toBeLessThan(64 * 1024)
        expect(payloads[1].message.content.text?.length).toBe(100_000)
        expect(await client.syncCodexHistory('thread')).toEqual({ epoch: 0, revision: 1, checkpoint: null })
        socket.ack = async () => ({ ok: false })
        await expect(client.syncCodexHistory('thread')).rejects.toThrow('did not confirm')
        client.close()
    })
    it('waits for persistence before consumption and skips confirmed history on reconnect', async () => {
        const client = new ApiSessionClient('token', createSession({
            metadata: { path: '/repo', host: 'test', capabilities: { concurrentClients: true } }
        }))
        const socket = socketHarness.sockets.at(-1)!
        const persisted = deferred<unknown>()
        const ack = vi.fn(() => persisted.promise)
        socket.ack = ack
        client.sendAgentMessage({ type: 'message', message: 'completed' }, 'stable', { replay: true })
        expect(ack).toHaveBeenCalledTimes(1)
        expect(socket.emitted.filter(e => e.event === 'messages-consumed')).toHaveLength(0)
        persisted.resolve({ ok: true })
        await vi.waitFor(() => expect(socket.emitted.filter(e => e.event === 'messages-consumed')).toHaveLength(1))
        socket.connected = false
        socket.trigger('disconnect', 'transport close')
        socket.triggerConnect()
        client.sendAgentMessage({ type: 'message', message: 'completed' }, 'stable', { replay: true })
        expect(ack).toHaveBeenCalledTimes(1)
        client.close()
    })

    it('keeps flush unconfirmed when the hub rejects transcript persistence', async () => {
        const client = new ApiSessionClient('token', createSession({
            metadata: { path: '/repo', host: 'test', capabilities: { concurrentClients: true } }
        }))
        const socket = socketHarness.sockets.at(-1)!
        socket.ack = async () => ({ ok: false })
        client.sendUserMessage('native history', undefined, 'user-id', { replay: true })
        expect(await client.flush({ timeoutMs: 20 })).toBe(false)
        expect(socket.emitted.filter(e => e.event === 'messages-consumed')).toHaveLength(0)
        client.close()
    })
})

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: '11111111-1111-4111-8111-111111111111',
        namespace: 'pending',
        seq: 0,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: null,
        metadataVersion: 0,
        agentState: { controlledByUser: false },
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 1,
        todos: [],
        model: null,
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        permissionMode: undefined,
        collaborationMode: undefined,
        ...overrides
    }
}

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve
        reject = promiseReject
    })
    return { promise, resolve, reject }
}

function triggerIncomingUserMessage(
    socket: (typeof socketHarness.sockets)[number],
    message: {
        id?: string
        seq: number
        text: string
        sentFrom: 'cli' | 'webapp' | 'telegram-bot'
    }
): void {
    socket.trigger('update', {
        body: {
            t: 'new-message',
            message: {
                id: message.id,
                seq: message.seq,
                localId: null,
                content: {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: message.text
                    },
                    meta: {
                        sentFrom: message.sentFrom
                    }
                }
            }
        }
    })
}

describe('ApiSessionClient lazy materialization', () => {
    it('does not connect or materialize without a real user message', async () => {
        socketHarness.sockets.length = 0
        const materialize = vi.fn(async () => createSession())
        const client = new ApiSessionClient('token', createSession(), { materialize })

        client.updateMetadata(() => ({ path: '/tmp/project', host: 'localhost', codexSessionId: 'codex-thread' }))
        client.sendSessionEvent({ type: 'ready' })
        client.keepAlive(false, 'local')
        await client.flush({ timeoutMs: 100 })

        expect(client.getState()).toBe('pending')
        expect(materialize).not.toHaveBeenCalled()
        expect(socketHarness.sockets[0]?.connectCalls).toBe(0)
        expect(socketHarness.sockets[0]?.emitted).toEqual([])
        client.close()
    })

    it('materializes on the first user message and replays queued events', async () => {
        socketHarness.sockets.length = 0
        const materialize = vi.fn(async (snapshot) => createSession({
            namespace: 'default',
            metadata: snapshot.metadata,
            metadataVersion: 1,
            agentState: snapshot.agentState,
            agentStateVersion: 1
        }))
        const client = new ApiSessionClient('token', createSession(), { materialize })
        client.updateMetadata(() => ({ path: '/tmp/project', host: 'localhost', codexSessionId: 'codex-thread' }))
        client.sendSessionEvent({ type: 'ready' })

        client.sendUserMessage('hello')
        expect(await client.materialize()).toBe(true)

        expect(materialize).toHaveBeenCalledWith({
            metadata: { path: '/tmp/project', host: 'localhost', codexSessionId: 'codex-thread' },
            agentState: { controlledByUser: false }
        }, expect.any(AbortSignal))
        expect(client.getState()).toBe('active')
        expect(socketHarness.sockets[0]?.connectCalls).toBe(1)
        expect(socketHarness.sockets[0]?.emitted.map((entry) => entry.event)).toEqual([
            'message',
            'message',
            'session-alive'
        ])
        client.close()
    })

    it('materializes on non-text user activity and preserves following agent events', async () => {
        socketHarness.sockets.length = 0
        const pendingMaterialization = deferred<Session>()
        const materialize = vi.fn(async () => await pendingMaterialization.promise)
        const client = new ApiSessionClient('token', createSession(), { materialize })

        client.notifyUserActivity()
        client.sendAgentMessage({ type: 'message', message: 'image response' })
        expect(client.getState()).toBe('materializing')

        pendingMaterialization.resolve(createSession({ namespace: 'default' }))
        expect(await client.materialize()).toBe(true)

        expect(materialize).toHaveBeenCalledTimes(1)
        const messages = socketHarness.sockets[0]?.emitted.filter((entry) => entry.event === 'message')
        expect(messages).toHaveLength(1)
        client.close()
    })

    it('preserves all replayed transcript messages while materialization is in flight', async () => {
        socketHarness.sockets.length = 0
        const pendingMaterialization = deferred<Session>()
        const client = new ApiSessionClient('token', createSession(), {
            materialize: async () => await pendingMaterialization.promise
        })
        const expectedMessages: string[] = []

        for (let index = 0; index < 150; index += 1) {
            const userMessage = `user-${index}`
            const agentMessage = `agent-${index}`
            expectedMessages.push(userMessage, agentMessage)
            client.sendUserMessage(userMessage)
            client.sendAgentMessage({ type: 'message', message: agentMessage })
        }

        pendingMaterialization.resolve(createSession({ namespace: 'default' }))
        expect(await client.materialize()).toBe(true)

        const emittedMessages = socketHarness.sockets[0]?.emitted
            .filter((entry) => entry.event === 'message')
            .map((entry) => {
                const payload = entry.args[0] as {
                    message: {
                        role: 'user' | 'agent'
                        content: { text?: string; data?: { message?: string } }
                    }
                }
                return payload.message.role === 'user'
                    ? payload.message.content.text
                    : payload.message.content.data?.message
            })

        expect(emittedMessages).toEqual(expectedMessages)
        client.close()
    })

    it('keeps an error event when the pending droppable queue overflows during materialization', async () => {
        socketHarness.sockets.length = 0
        const pendingMaterialization = deferred<Session>()
        const client = new ApiSessionClient('token', createSession(), {
            materialize: async () => await pendingMaterialization.promise
        })

        client.notifyUserActivity()
        client.sendSessionEvent({ type: 'error', message: 'Antigravity quota reached' })
        for (let index = 0; index < 300; index += 1) {
            client.sendSessionEvent({ type: 'ready' })
        }

        pendingMaterialization.resolve(createSession({ namespace: 'default' }))
        expect(await client.materialize()).toBe(true)

        const events = socketHarness.sockets[0]?.emitted
            .filter((entry) => entry.event === 'message')
            .map((entry) => (entry.args[0] as { message: { content: { data: { type: string; message?: string } } } }).message.content.data)
        expect(events).toContainEqual({ type: 'error', message: 'Antigravity quota reached' })
        client.close()
    })

    it('keeps an api-error retry event when the pending droppable queue overflows', async () => {
        socketHarness.sockets.length = 0
        const pendingMaterialization = deferred<Session>()
        const client = new ApiSessionClient('token', createSession(), {
            materialize: async () => await pendingMaterialization.promise
        })

        client.notifyUserActivity()
        client.sendSessionEvent({
            type: 'api-error',
            retryAttempt: 5,
            maxRetries: 5,
            error: { message: 'Too many requests', status: 429 },
            retryScheduled: true
        })
        for (let index = 0; index < 300; index += 1) {
            client.sendSessionEvent({ type: 'ready' })
        }

        pendingMaterialization.resolve(createSession({ namespace: 'default' }))
        expect(await client.materialize()).toBe(true)

        const events = socketHarness.sockets[0]?.emitted
            .filter((entry) => entry.event === 'message')
            .map((entry) => (entry.args[0] as { message: { content: { data: { type: string } } } }).message.content.data)
        expect(events).toContainEqual({
            type: 'api-error',
            retryAttempt: 5,
            maxRetries: 5,
            error: { message: 'Too many requests', status: 429 },
            retryScheduled: true
        })
        client.close()
    })

    it('drains in-flight materialization and initial socket delivery before closing', async () => {
        socketHarness.sockets.length = 0
        const pendingMaterialization = deferred<Session>()
        const client = new ApiSessionClient('token', createSession(), {
            materialize: async () => await pendingMaterialization.promise
        })
        const socket = socketHarness.sockets[0]
        if (!socket) throw new Error('expected socket')
        socket.connectImmediately = false

        client.sendUserMessage('persist me')
        client.sendAgentMessage({ type: 'message', message: 'persist response' })
        client.sendSessionDeath('completed')

        let flushed = false
        const flushTask = client.flush({ timeoutMs: 1_000 }).then(() => {
            flushed = true
        })
        await Promise.resolve()
        expect(flushed).toBe(false)

        pendingMaterialization.resolve(createSession({ namespace: 'default' }))
        await vi.waitFor(() => expect(socket.connectCalls).toBe(1))
        expect(flushed).toBe(false)

        socket.triggerConnectError()
        await Promise.resolve()
        expect(flushed).toBe(false)

        socket.triggerConnect()
        await flushTask

        expect(socket.emitted.map((entry) => entry.event)).toEqual([
            'message',
            'message',
            'session-end',
            'session-alive'
        ])
        client.close()
    })

    it('skips materialization backoff and performs one final attempt during shutdown drain', async () => {
        socketHarness.sockets.length = 0
        const materialize = vi.fn(async () => {
            if (materialize.mock.calls.length === 1) {
                throw Object.assign(new Error('hub unavailable'), { isAxiosError: true })
            }
            return createSession({ namespace: 'default' })
        })
        const client = new ApiSessionClient('token', createSession(), { materialize })

        client.sendUserMessage('hello')
        await vi.waitFor(() => expect(materialize).toHaveBeenCalledTimes(1))
        await Promise.resolve()

        await client.flush({ timeoutMs: 500 })

        expect(materialize).toHaveBeenCalledTimes(2)
        expect(client.getState()).toBe('active')
        expect(socketHarness.sockets[0]?.emitted.some((entry) => entry.event === 'message')).toBe(true)
        client.close()
    })

    it('aborts in-flight materialization when closed', async () => {
        socketHarness.sockets.length = 0
        const observedSignals: AbortSignal[] = []
        const materialize = vi.fn(async (_snapshot, signal: AbortSignal) => {
            observedSignals.push(signal)
            return await new Promise<Session>((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            })
        })
        const client = new ApiSessionClient('token', createSession(), { materialize })

        const task = client.materialize()
        await Promise.resolve()
        client.close()

        expect(await task).toBe(false)
        expect(observedSignals[0]?.aborted).toBe(true)
        expect(client.getState()).toBe('closed')
    })

    it('reconnects a disconnected active session during final flush', async () => {
        socketHarness.sockets.length = 0
        const client = new ApiSessionClient('token', createSession({ namespace: 'default' }))
        const socket = socketHarness.sockets[0]
        if (!socket) throw new Error('expected socket')
        socket.connected = false
        socket.connectImmediately = false
        client.sendSessionDeath('completed')

        let flushed = false
        const flushTask = client.flush({ timeoutMs: 500 }).then(() => {
            flushed = true
        })
        await vi.waitFor(() => expect(socket.connectCalls).toBe(2))
        expect(flushed).toBe(false)

        socket.triggerConnect()
        await flushTask

        expect(socket.emitted.some((entry) => entry.event === 'session-end')).toBe(true)
        client.close()
    })

    it('reports an unconfirmed final flush when the socket cannot reconnect before the deadline', async () => {
        socketHarness.sockets.length = 0
        const client = new ApiSessionClient('token', createSession({ namespace: 'default' }))
        const socket = socketHarness.sockets[0]
        if (!socket) throw new Error('expected socket')
        socket.connected = false
        socket.connectImmediately = false
        client.sendSessionDeath('cleared')

        await expect(client.flush({ timeoutMs: 20 })).resolves.toBe(false)

        expect(socket.connectCalls).toBeGreaterThan(0)
        client.close()
    })
})

describe('ApiSessionClient agy transcript messages', () => {
    it('renders only the USER_REQUEST body, not the sections agy appends', () => {
        socketHarness.sockets.length = 0
        const client = new ApiSessionClient('token', createSession({ namespace: 'default' }))
        const socket = socketHarness.sockets[0]
        if (!socket) throw new Error('expected socket')

        // The shape agy actually writes for every terminal-typed message.
        client.sendAgySessionMessage({
            step_index: 0,
            source: 'USER_EXPLICIT',
            type: 'USER_INPUT',
            status: 'DONE',
            created_at: '2026-08-04T00:00:00Z',
            content: [
                '<USER_REQUEST>',
                'hi',
                '</USER_REQUEST>',
                '<ADDITIONAL_METADATA>',
                'The current local time is: 2026-08-04T09:00:00+09:00.',
                '</ADDITIONAL_METADATA>',
                '<USER_SETTINGS_CHANGE>',
                'The user changed setting `Model Selection` from None to Gemini 3.6 Flash (Low).',
                '</USER_SETTINGS_CHANGE>',
            ].join('\n'),
        } as never)

        const emitted = socket.emitted.find((entry) => entry.event === 'message')
        expect(emitted).toBeDefined()
        expect((emitted!.args[0] as any).message.content.text).toBe('hi')
        client.close()
    })
})

describe('ApiSessionClient incoming user messages', () => {
    it.each([true, false])('replays explicitly marked native queue input only for shared sessions (%s)', shared => {
        socketHarness.sockets.length = 0
        const client = new ApiSessionClient('token', createSession({
            metadata: { path: '/tmp', host: 'test', capabilities: { concurrentClients: shared } }
        }))
        const socket = socketHarness.sockets[0]
        const received = vi.fn()
        client.onUserMessage(received)
        const message = { id: 'native-queued', seq: 10, localId: 'native-client-id', content: {
            role: 'user', content: { type: 'text', text: 'queued before exit' },
            meta: { sentFrom: 'cli', isNativeQueuedMessage: true }
        } }
        socket.trigger('update', { body: { t: 'new-message', message } })
        socket.trigger('update', { body: { t: 'new-message', message } })
        expect(received).toHaveBeenCalledTimes(shared ? 1 : 0)
        if (shared) expect(received).toHaveBeenCalledWith(expect.objectContaining({
            content: { type: 'text', text: 'queued before exit' }
        }), 'native-client-id')
        client.close()
    })
    it('ignores CLI-originated transcript messages while advancing the incoming cursor', () => {
        socketHarness.sockets.length = 0
        const client = new ApiSessionClient('token', createSession({ namespace: 'default' }))
        const socket = socketHarness.sockets[0]
        if (!socket) throw new Error('expected socket')
        const onUserMessage = vi.fn()
        client.onUserMessage(onUserMessage)

        triggerIncomingUserMessage(socket, {
            id: 'historical-cli-message',
            seq: 10,
            text: 'historical prompt from the local transcript',
            sentFrom: 'cli'
        })
        triggerIncomingUserMessage(socket, {
            seq: 10,
            text: 'legacy duplicate at the filtered cursor',
            sentFrom: 'webapp'
        })
        triggerIncomingUserMessage(socket, {
            id: 'live-web-message',
            seq: 11,
            text: 'new prompt from the phone',
            sentFrom: 'webapp'
        })

        expect(onUserMessage).toHaveBeenCalledTimes(1)
        expect(onUserMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.objectContaining({ text: 'new prompt from the phone' })
            }),
            undefined
        )
        client.close()
    })

    it('delivers only remote prompts from a mixed reconnect backfill', async () => {
        socketHarness.sockets.length = 0
        axiosHarness.get.mockReset()
        axiosHarness.get.mockResolvedValue({
            data: {
                messages: [
                    {
                        id: 'backfilled-cli-message',
                        seq: 2,
                        createdAt: 2,
                        localId: null,
                        content: {
                            role: 'user',
                            content: { type: 'text', text: 'historical local prompt' },
                            meta: { sentFrom: 'cli' }
                        }
                    },
                    {
                        id: 'backfilled-web-message',
                        seq: 3,
                        createdAt: 3,
                        localId: null,
                        content: {
                            role: 'user',
                            content: { type: 'text', text: 'remote prompt after reconnect' },
                            meta: { sentFrom: 'webapp' }
                        }
                    }
                ]
            }
        })
        const client = new ApiSessionClient('token', createSession({ namespace: 'default' }))
        const socket = socketHarness.sockets[0]
        if (!socket) throw new Error('expected socket')
        const receivedTexts: string[] = []
        client.onUserMessage((message) => {
            receivedTexts.push(message.content.text)
        })
        triggerIncomingUserMessage(socket, {
            id: 'initial-web-message',
            seq: 1,
            text: 'initial remote prompt',
            sentFrom: 'webapp'
        })

        socket.connected = false
        socket.trigger('disconnect', 'transport close')
        socket.triggerConnect()

        await vi.waitFor(() => expect(axiosHarness.get).toHaveBeenCalledOnce())
        await vi.waitFor(() => expect(receivedTexts).toEqual([
            'initial remote prompt',
            'remote prompt after reconnect'
        ]))
        expect(axiosHarness.get).toHaveBeenCalledWith(
            expect.stringContaining('/cli/sessions/'),
            expect.objectContaining({
                params: { afterSeq: 1, limit: 200 }
            })
        )
        client.close()
    })

    it.each(['webapp', 'telegram-bot'] as const)(
        'delivers %s-originated user messages',
        (sentFrom) => {
            socketHarness.sockets.length = 0
            const client = new ApiSessionClient('token', createSession({ namespace: 'default' }))
            const socket = socketHarness.sockets[0]
            if (!socket) throw new Error('expected socket')
            const onUserMessage = vi.fn()
            client.onUserMessage(onUserMessage)

            triggerIncomingUserMessage(socket, {
                id: `${sentFrom}-message`,
                seq: 1,
                text: `prompt from ${sentFrom}`,
                sentFrom
            })

            expect(onUserMessage).toHaveBeenCalledOnce()
            expect(onUserMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    meta: { sentFrom }
                }),
                undefined
            )
            client.close()
        }
    )
})

describe('isExternalUserMessage', () => {
    const baseUserMsg = {
        type: 'user' as const,
        uuid: 'test-uuid',
        userType: 'external' as const,
        isSidechain: false,
        message: { role: 'user', content: 'hello' },
    }

    it('returns true for a real user text message', () => {
        expect(isExternalUserMessage(baseUserMsg)).toBe(true)
    })

    it('returns false when isMeta is true (skill injections)', () => {
        expect(isExternalUserMessage({ ...baseUserMsg, isMeta: true })).toBe(false)
    })

    it('returns false when isSidechain is true', () => {
        expect(isExternalUserMessage({ ...baseUserMsg, isSidechain: true })).toBe(false)
    })

    it('returns true when content is an array of text blocks', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: [{ type: 'text', text: 'hello array' }] },
            } as never)
        ).toBe(true)
    })

    it('returns false when content is a non-text array (tool results)', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'y' }] },
            } as never)
        ).toBe(false)
    })

    it('returns false for assistant messages', () => {
        expect(
            isExternalUserMessage({
                type: 'assistant',
                uuid: 'test-uuid',
                message: { role: 'assistant', content: 'hi' },
            } as never)
        ).toBe(false)
    })

    // System-injected content detection
    it('returns false for <task-notification> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<task-notification>\n<task-id>abc123</task-id>\n</task-notification>' },
            })
        ).toBe(false)
    })

    it('returns false for <command-name> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<command-name>/clear</command-name>' },
            })
        ).toBe(false)
    })

    it('returns false for <local-command-caveat> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<local-command-caveat>Caveat: ...</local-command-caveat>' },
            })
        ).toBe(false)
    })

    it('returns false for <system-reminder> messages', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '<system-reminder>\nToday is 2026.\n</system-reminder>' },
            })
        ).toBe(false)
    })

    it('returns true for user text that mentions XML-like strings but is not injected', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: 'How do I use the <task-notification> tag?' },
            })
        ).toBe(true)
    })

    it('returns false for <task-notification> with leading whitespace', () => {
        expect(
            isExternalUserMessage({
                ...baseUserMsg,
                message: { role: 'user', content: '  \n<task-notification>\n<task-id>x</task-id>\n</task-notification>' },
            })
        ).toBe(false)
    })
})

describe('IncomingMessageFilter (HAPI Bot R3 finding #1)', () => {
    it('accepts a mature scheduled message whose seq is below the latest cursor', () => {
        // schedule seq=10, immediate seq=11 acks first → cursor=11.
        // seq=10 matures: seq-only dedup would drop it; id-based dedup must accept.
        const filter = new IncomingMessageFilter()
        expect(filter.accept({ id: 'msg-imm', seq: 11 })).toBe(true)
        expect(filter.accept({ id: 'msg-sched', seq: 10 })).toBe(true)
    })

    it('rejects an exact id duplicate (re-emit on the next mature tick)', () => {
        const filter = new IncomingMessageFilter()
        expect(filter.accept({ id: 'msg-1', seq: 1 })).toBe(true)
        expect(filter.accept({ id: 'msg-1', seq: 1 })).toBe(false)
    })

    it('falls back to seq-only dedup for messages without an id', () => {
        const filter = new IncomingMessageFilter()
        expect(filter.accept({ seq: 5 })).toBe(true)
        // seq <= cursor and no id → drop (legacy behaviour preserved).
        expect(filter.accept({ seq: 4 })).toBe(false)
        expect(filter.accept({ seq: 5 })).toBe(false)
    })

    it('advances cursorSeq monotonically regardless of arrival order', () => {
        const filter = new IncomingMessageFilter()
        filter.accept({ id: 'a', seq: 11 })
        filter.accept({ id: 'b', seq: 10 })
        expect(filter.cursorSeq()).toBe(11)
    })

    it('bounds the seen-id set to the configured capacity (LRU eviction)', () => {
        const filter = new IncomingMessageFilter(3)
        filter.accept({ id: 'a', seq: 1 })
        filter.accept({ id: 'b', seq: 2 })
        filter.accept({ id: 'c', seq: 3 })
        filter.accept({ id: 'd', seq: 4 })
        // 'a' should have been evicted — re-presenting it is treated as new.
        expect(filter.accept({ id: 'a', seq: 5 })).toBe(true)
        // 'd' is still in the set.
        expect(filter.accept({ id: 'd', seq: 6 })).toBe(false)
    })

    it('refreshes recency on dedup hit so re-emits survive bursts of unrelated ids', () => {
        // Models the documented contract: the hub re-emits the same id every 5 s
        // until the CLI acks.  If the dedup were FIFO (insert-order only), a
        // burst of capacity-many unrelated ids between re-emits would evict the
        // pending id and the next re-emit would double-deliver.
        const filter = new IncomingMessageFilter(3)
        // Pre-fill so 'pending' is not at the head.
        filter.accept({ id: 'a', seq: 1 })
        filter.accept({ id: 'pending', seq: 2 })
        filter.accept({ id: 'b', seq: 3 })
        // Re-emit pending → recency refresh moves it to the tail.
        expect(filter.accept({ id: 'pending', seq: 4 })).toBe(false)
        // Burst that evicts oldest entries.  Without the refresh 'pending' would
        // be at insert position 2 and would be evicted; with the refresh it is
        // now the newest entry and survives.
        filter.accept({ id: 'c', seq: 5 })
        filter.accept({ id: 'd', seq: 6 })
        // 'a' (oldest) and then 'b' should have been evicted; 'pending' must
        // still dedup.
        expect(filter.accept({ id: 'pending', seq: 7 })).toBe(false)
        expect(filter.accept({ id: 'a', seq: 8 })).toBe(true)
        expect(filter.accept({ id: 'b', seq: 9 })).toBe(true)
    })
})
