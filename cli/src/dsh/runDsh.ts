import { bootstrapExistingSession, bootstrapSession } from '@/agent/sessionFactory'
import { convertAgentMessage } from '@/agent/messageConverter'
import { createRunnerLifecycle, setControlledByUser } from '@/agent/runnerLifecycle'
import { registerSessionConfigRpc } from '@/agent/sessionConfigRpc'
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler'
import { formatMessageWithAttachments } from '@/utils/attachmentFormatter'
import { hashObject } from '@/utils/deterministicJson'
import { getInvokedCwd } from '@/utils/invokedCwd'
import { MessageQueue2 } from '@/utils/MessageQueue2'
import { logger } from '@/ui/logger'
import { randomUUID } from 'node:crypto'
import type { DshPermissionMode } from '@hapi/protocol'
import type { DshModelsResponse } from '@hapi/protocol/apiTypes'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { convertDshEvent } from './dshEvents'
import { getDshModelsForSession } from './dshModels'
import {
    DshWebClient,
    type DshModelSelection,
    type DshModelSummary,
    type DshServerRequest,
    type DshSessionEvent
} from './dshWebClient'

type DshQueueMode = {
    deliveryMode: 'queue' | 'steer'
}

type DshNativePermissionMode = Exclude<DshPermissionMode, 'default'>

type PendingTurn = {
    userSeen: boolean
    resolve: () => void
    reject: (error: Error) => void
}

type PermissionResponseMessage = {
    id: string
    approved: boolean
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    answers?: Record<string, string[]> | Record<string, { answers: string[] }>
}

export type DshQuestion = {
    id: string
    question: string
    header?: string
    detail?: string
    options?: Array<{ label: string; description?: string }>
    multiSelect?: boolean
}

type PendingQuestion = {
    rpcId: string
    questions: DshQuestion[]
    createdAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function eventSourceRpcId(event: DshSessionEvent): string | null {
    if (event.type !== 'user/message' || !isRecord(event.data) || !isRecord(event.data.source)) return null
    return typeof event.data.source.rpcId === 'string' ? event.data.source.rpcId : null
}

function eventPermissionPreset(event: DshSessionEvent): DshNativePermissionMode | null {
    if (event.type !== 'permission/preset' || !isRecord(event.data)) return null
    const preset = event.data.preset
    return preset === 'read-only' || preset === 'workspace-write' || preset === 'danger-full-access'
        ? preset
        : null
}

function summaryPermissionPreset(value: unknown): DshNativePermissionMode | null {
    if (!isRecord(value)) return null
    const preset = value.currentValue
    return preset === 'read-only' || preset === 'workspace-write' || preset === 'danger-full-access'
        ? preset
        : null
}

export function parseDshQuestions(value: unknown): DshQuestion[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((raw) => {
        if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.question !== 'string') return []
        const options = Array.isArray(raw.options)
            ? raw.options.flatMap((option) => {
                if (!isRecord(option) || typeof option.label !== 'string') return []
                return [{
                    label: option.label,
                    ...(typeof option.description === 'string' ? { description: option.description } : {})
                }]
            })
            : undefined
        return [{
            id: raw.id,
            question: raw.question,
            ...(typeof raw.header === 'string' ? { header: raw.header } : {}),
            ...(typeof raw.detail === 'string' ? { detail: raw.detail } : {}),
            ...(options ? { options } : {}),
            ...(typeof raw.multiSelect === 'boolean'
                ? { multiSelect: raw.multiSelect }
                : typeof raw.multi_select === 'boolean'
                    ? { multiSelect: raw.multi_select }
                    : {})
        }]
    })
}

function parseDshToolArguments(value: unknown): unknown {
    if (typeof value !== 'string') return value
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

export function questionFingerprint(questions: DshQuestion[]): string {
    return JSON.stringify(questions.map((question) => ({
        id: question.id,
        question: question.question,
        header: question.header ?? null,
        detail: question.detail ?? null,
        options: question.options ?? [],
        multiSelect: question.multiSelect === true
    })))
}

export function toHapiQuestionInput(questions: DshQuestion[]): Record<string, unknown> {
    return {
        questions: questions.map((question) => ({
            id: question.id,
            question: question.question,
            ...(question.header ? { header: question.header } : {}),
            ...(question.detail ? { detail: question.detail } : {}),
            ...(question.options ? {
                options: question.options.map((option) => ({
                    label: option.label,
                    ...(option.description ? { description: option.description } : {})
                }))
            } : {}),
            ...(question.multiSelect === true ? { multiSelect: true } : {})
        }))
    }
}

export function dshAnswerFromHapi(
    questions: DshQuestion[],
    answers: PermissionResponseMessage['answers']
): { answers: Array<{ id: string; selected: string[]; custom?: string }> } {
    return {
        answers: questions.map((question, index) => {
            const rawValue = answers?.[question.id] ?? answers?.[String(index)] ?? []
            const raw = Array.isArray(rawValue) ? rawValue : rawValue.answers
            const allowed = new Set(question.options?.map((option) => option.label) ?? [])
            const selected = raw.filter((value) => allowed.has(value))
            const customValues = raw.filter((value) => !allowed.has(value) && value.trim().length > 0)
            return {
                id: question.id,
                selected,
                ...(customValues.length > 0 ? { custom: customValues.join(', ') } : {})
            }
        })
    }
}

export function resolveDshQuestionRequest(
    questions: DshQuestion[],
    rpcId: string,
    questionToolCalls: Map<string, string>,
    resumableRequests: Map<string, { id: string; createdAt: number }>,
    now: number
): { requestId: string; createdAt: number } {
    const fingerprint = questionFingerprint(questions)
    const toolCallId = questionToolCalls.get(fingerprint)
    const resumed = resumableRequests.get(fingerprint)
    questionToolCalls.delete(fingerprint)
    resumableRequests.delete(fingerprint)
    return {
        requestId: resumed?.id ?? toolCallId ?? rpcId,
        createdAt: resumed?.createdAt ?? now
    }
}

export function shouldApplyDshPermissionPreset(
    requested: DshPermissionMode | undefined,
    nativeCurrent: DshNativePermissionMode | null
): requested is DshNativePermissionMode {
    return requested !== undefined
        && requested !== 'default'
        && requested !== nativeCurrent
}

function resolveRequestedModel(
    requested: string,
    models: readonly DshModelSummary[],
    preferredProvider?: string
): DshModelSummary {
    const exactRoute = models.find((entry) => `${entry.provider}/${entry.model}` === requested)
    if (exactRoute) return exactRoute
    const byModel = models.filter((entry) => entry.model === requested)
    if (byModel.length === 1) return byModel[0]!
    if (byModel.length > 1) {
        const preferred = preferredProvider
            ? byModel.find((entry) => entry.provider === preferredProvider)
            : null
        if (preferred) return preferred
        throw new Error(`DeepSeek Harness model ${requested} exists in multiple providers; use provider/model`)
    }
    throw new Error(`DeepSeek Harness model not found: ${requested}`)
}

export async function runDsh(opts: {
    startedBy?: 'runner' | 'terminal'
    startingMode?: 'local' | 'remote'
    permissionMode?: DshPermissionMode
    model?: string
    modelReasoningEffort?: string
    resumeSessionId?: string
    existingSessionId?: string
    workingDirectory?: string
} = {}): Promise<void> {
    const workingDirectory = opts.workingDirectory ?? getInvokedCwd()
    const startedBy = opts.startedBy ?? 'terminal'

    if (opts.startingMode === 'local') {
        logger.debug('[dsh] Local mode requested; forcing remote because DSH Web owns the native UI')
    }

    const bootstrap = opts.existingSessionId
        ? await bootstrapExistingSession({
            sessionId: opts.existingSessionId,
            flavor: 'dsh',
            startedBy,
            workingDirectory
        })
        : await bootstrapSession({
            flavor: 'dsh',
            startedBy,
            workingDirectory,
            model: opts.model,
            modelReasoningEffort: opts.modelReasoningEffort
        })
    const { session, sessionInfo } = bootstrap
    setControlledByUser(session, 'remote')

    const client = new DshWebClient()
    await client.describe()

    const muxAbort = new AbortController()
    const loopAbort = new AbortController()
    const queue = new MessageQueue2<DshQueueMode>((mode) => hashObject(mode))
    const pendingTurns = new Map<string, PendingTurn>()
    const pendingQuestions = new Map<string, PendingQuestion>()
    const questionToolCalls = new Map<string, string>()
    const resumableQuestionRequests = new Map<string, { id: string; createdAt: number }>()
    const ownedRpcIds = new Set<string>()
    const pendingApprovals = new Map<string, { rpcId: string; toolName: string; arguments: unknown; createdAt: number }>()

    for (const [id, request] of Object.entries(sessionInfo.agentState?.requests ?? {})) {
        if (request.tool !== 'ask_user_question' || !isRecord(request.arguments)) continue
        const questions = parseDshQuestions(request.arguments.questions)
        if (questions.length === 0) continue
        resumableQuestionRequests.set(questionFingerprint(questions), {
            id,
            createdAt: request.createdAt ?? Date.now()
        })
    }

    let nativeSessionId = opts.resumeSessionId ?? sessionInfo.metadata?.dshSessionId ?? null
    let thinking = false
    let stopped = false
    let currentPermissionMode: DshPermissionMode = opts.permissionMode
        ?? (sessionInfo.permissionMode as DshPermissionMode | undefined)
        ?? 'default'
    let nativeDefaultPermissionMode: DshNativePermissionMode | null = null
    let currentModel: string | null = sessionInfo.model ?? opts.model ?? null
    let currentReasoningEffort: string | null = sessionInfo.modelReasoningEffort ?? opts.modelReasoningEffort ?? null
    let currentSelection: DshModelSelection | null = null
    let nativeTurnStateObserved = false
    let keepAliveInterval: ReturnType<typeof setInterval> | null = null
    let latestEventSeq = sessionInfo.metadata?.dshHistoryLastEventSeq ?? -1

    const syncKeepAlive = () => {
        session.keepAlive(thinking, 'remote', {
            permissionMode: currentPermissionMode,
            model: currentModel,
            modelReasoningEffort: currentReasoningEffort
        })
    }

    const finishPendingApprovals = (reason: string) => {
        const now = Date.now()
        session.updateAgentState((state) => {
            const completedRequests = { ...state.completedRequests }
            for (const [id, pending] of pendingApprovals) {
                completedRequests[id] = {
                    tool: pending.toolName,
                    arguments: pending.arguments,
                    createdAt: pending.createdAt,
                    completedAt: now,
                    status: 'canceled',
                    reason,
                    decision: 'abort'
                }
            }
            return { ...state, requests: {}, completedRequests }
        })
        pendingApprovals.clear()
    }

    const finishPendingQuestions = (reason: string) => {
        const now = Date.now()
        for (const pending of pendingQuestions.values()) {
            void client.cancelResponse(pending.rpcId).catch((error) => {
                logger.debug('[dsh] Failed to cancel pending user question:', error)
            })
        }
        session.updateAgentState((state) => {
            const completedRequests = { ...state.completedRequests }
            const requests = { ...state.requests }
            for (const [id, pending] of pendingQuestions) {
                delete requests[id]
                completedRequests[id] = {
                    tool: 'ask_user_question',
                    arguments: toHapiQuestionInput(pending.questions),
                    createdAt: pending.createdAt,
                    completedAt: now,
                    status: 'canceled',
                    reason,
                    decision: 'abort'
                }
            }
            return { ...state, requests, completedRequests }
        })
        pendingQuestions.clear()
        questionToolCalls.clear()
    }

    const failPendingTurns = (error: Error) => {
        for (const pending of pendingTurns.values()) pending.reject(error)
        pendingTurns.clear()
    }

    const lifecycle = createRunnerLifecycle({
        session,
        logTag: 'dsh',
        stopKeepAlive: () => {
            if (keepAliveInterval) clearInterval(keepAliveInterval)
            keepAliveInterval = null
        },
        onBeforeClose: async () => {
            stopped = true
            queue.close()
            loopAbort.abort()
            muxAbort.abort()
            failPendingTurns(new Error('DeepSeek Harness session stopped'))
            finishPendingApprovals('Session stopped')
            finishPendingQuestions('Session stopped')
            if (thinking && nativeSessionId) {
                try {
                    await client.cancel(nativeSessionId)
                } catch (error) {
                    logger.debug('[dsh] Failed to cancel native turn during shutdown:', error)
                }
            }
        }
    })
    lifecycle.registerProcessHandlers()
    registerKillSessionHandler(session.rpcHandlerManager, lifecycle)

    const handleMuxFrame = (request: DshServerRequest) => {
        const frame = request.payload
        if (frame.sessionId !== nativeSessionId) return

        if (frame.type === 'approval/requested') {
            const approvalId = typeof frame.approvalId === 'string' ? frame.approvalId : null
            const toolName = typeof frame.toolName === 'string' ? frame.toolName : 'DeepSeek Harness tool'
            if (!approvalId || pendingApprovals.has(approvalId)) return
            const createdAt = Date.now()
            const argumentsValue = {
                ...(typeof frame.callId === 'string' ? { callId: frame.callId } : {}),
                ...(typeof frame.reason === 'string' ? { reason: frame.reason } : {})
            }
            pendingApprovals.set(approvalId, {
                rpcId: request.rpcId,
                toolName,
                arguments: argumentsValue,
                createdAt
            })
            session.updateAgentState((state) => ({
                ...state,
                requests: {
                    ...state.requests,
                    [approvalId]: { tool: toolName, arguments: argumentsValue, createdAt }
                }
            }))
            return
        }

        if (frame.type === 'approval/resolved') {
            const approvalId = typeof frame.approvalId === 'string' ? frame.approvalId : null
            if (!approvalId) return
            const pending = pendingApprovals.get(approvalId)
            if (!pending) return
            pendingApprovals.delete(approvalId)
            const approved = frame.outcome === 'allowed-once'
            session.updateAgentState((state) => {
                const { [approvalId]: _, ...requests } = state.requests ?? {}
                return {
                    ...state,
                    requests,
                    completedRequests: {
                        ...state.completedRequests,
                        [approvalId]: {
                            tool: pending.toolName,
                            arguments: pending.arguments,
                            createdAt: pending.createdAt,
                            completedAt: Date.now(),
                            status: approved ? 'approved' : 'denied',
                            decision: approved ? 'approved' : 'denied'
                        }
                    }
                }
            })
            return
        }

        if (frame.type === 'question/requested') {
            const questions = parseDshQuestions(frame.questions)
            if (questions.length === 0) {
                session.sendSessionEvent({ type: 'error', message: 'DeepSeek Harness sent an invalid user question.' })
                void client.cancelResponse(request.rpcId).catch((error) => {
                    logger.debug('[dsh] Failed to cancel invalid user question:', error)
                })
                return
            }
            const { requestId, createdAt } = resolveDshQuestionRequest(
                questions,
                request.rpcId,
                questionToolCalls,
                resumableQuestionRequests,
                Date.now()
            )
            thinking = false
            session.updateAgentState((state) => ({
                ...state,
                requests: {
                    ...state.requests,
                    [requestId]: {
                        tool: 'ask_user_question',
                        arguments: toHapiQuestionInput(questions),
                        createdAt
                    }
                }
            }))
            pendingQuestions.set(requestId, { rpcId: request.rpcId, questions, createdAt })
            syncKeepAlive()
            return
        }

        if (frame.type === 'question/resolved') {
            const questionRpcId = typeof frame.questionRpcId === 'string' ? frame.questionRpcId : null
            if (questionRpcId) {
                const match = Array.from(pendingQuestions.entries())
                    .find(([, pending]) => pending.rpcId === questionRpcId)
                if (match) {
                    const [requestId, pending] = match
                    pendingQuestions.delete(requestId)
                    thinking = true
                    session.updateAgentState((state) => {
                        const { [requestId]: _, ...requests } = state.requests ?? {}
                        return {
                            ...state,
                            requests,
                            completedRequests: {
                                ...state.completedRequests,
                                [requestId]: {
                                    tool: 'ask_user_question',
                                    arguments: toHapiQuestionInput(pending.questions),
                                    createdAt: pending.createdAt,
                                    completedAt: Date.now(),
                                    status: frame.outcome === 'answered' ? 'approved' : 'canceled',
                                    decision: frame.outcome === 'answered' ? 'approved' : 'abort'
                                }
                            }
                        }
                    })
                    syncKeepAlive()
                }
            }
            return
        }

        if (frame.type !== 'session/event' || !frame.event) return
        const event = frame.event
        if (event.type === 'tool/call' && isRecord(event.data)
            && event.data.name === 'ask_user_question'
            && typeof event.data.callId === 'string') {
            const input = parseDshToolArguments(event.data.arguments)
            const questions = isRecord(input) ? parseDshQuestions(input.questions) : []
            if (questions.length > 0) {
                questionToolCalls.set(questionFingerprint(questions), event.data.callId)
            }
        }
        latestEventSeq = Math.max(latestEventSeq, event.seq)
        const sourceRpcId = eventSourceRpcId(event)
        if (sourceRpcId) {
            const pending = pendingTurns.get(sourceRpcId)
            if (pending) pending.userSeen = true
        }

        const preset = eventPermissionPreset(event)
        if (preset) {
            currentPermissionMode = preset
            session.sendSessionEvent({ type: 'permission-mode-changed', mode: preset })
        }

        if (event.type === 'turn/start') {
            nativeTurnStateObserved = true
            thinking = true
        } else if (event.type === 'turn/end') {
            nativeTurnStateObserved = true
            thinking = false
            questionToolCalls.clear()
            resumableQuestionRequests.clear()
            session.updateMetadata((metadata) => ({
                ...metadata,
                dshHistoryLastEventSeq: latestEventSeq,
                ...(metadata.dshImportState ? {
                    dshImportState: {
                        ...metadata.dshImportState,
                        updatedAt: Date.now(),
                        lastEventSeq: latestEventSeq
                    }
                } : {})
            }))
            for (const [rpcId, pending] of pendingTurns) {
                if (!pending.userSeen) continue
                pendingTurns.delete(rpcId)
                pending.resolve()
            }
            if (queue.size() === 0) session.sendSessionEvent({ type: 'ready' })
        }

        const converted = convertDshEvent(event, { event, ...(frame.view !== undefined ? { view: frame.view } : {}) })
        if (converted.model) currentModel = converted.model
        if (converted.reasoningEffort) currentReasoningEffort = converted.reasoningEffort

        if (converted.humanText && (!sourceRpcId || !ownedRpcIds.has(sourceRpcId))) {
            session.sendUserMessage(converted.humanText)
        }
        for (const message of converted.messages) {
            const body = convertAgentMessage(message, converted.model ?? currentModel ?? undefined)
            if (body) session.sendAgentMessage(body)
        }
        for (const eventData of converted.events ?? []) {
            session.sendSessionEvent(eventData)
        }
        syncKeepAlive()
    }

    try {
        await client.subscribeMux({
            signal: muxAbort.signal,
            onFrame: handleMuxFrame,
            onError: (error) => {
                if (stopped || muxAbort.signal.aborted) return
                session.sendSessionEvent({ type: 'error', message: error.message })
                failPendingTurns(error)
                loopAbort.abort(error)
            }
        })

        let nativeSummary
        if (!nativeSessionId) {
            nativeSessionId = await client.createSession({ cwd: workingDirectory })
            nativeSummary = (await client.listSessions()).find((entry) => entry.sessionId === nativeSessionId)
        } else {
            nativeSummary = (await client.listSessions()).find((entry) => entry.sessionId === nativeSessionId)
            if (!nativeSummary) throw new Error(`DeepSeek Harness session not found: ${nativeSessionId}`)
        }
        if (!nativeTurnStateObserved) thinking = nativeSummary?.running === true

        const projectedPermission = summaryPermissionPreset(nativeSummary?.projections?.values.permissions)
        if (projectedPermission) {
            nativeDefaultPermissionMode = projectedPermission
            currentPermissionMode = projectedPermission
        }

        session.updateMetadata((metadata) => ({ ...metadata, dshSessionId: nativeSessionId! }))

        const catalog = await client.getModels(nativeSessionId)
        currentSelection = catalog.current
        currentModel = currentSelection.model
        currentReasoningEffort = currentSelection.reasoningEffort ?? null

        session.rpcHandlerManager.registerHandler<Record<string, never>, DshModelsResponse>(
            RPC_METHODS.ListDshModels,
            async () => {
                try {
                    return await getDshModelsForSession(client, nativeSessionId!)
                } catch (error) {
                    return {
                        success: false,
                        error: error instanceof Error ? error.message : 'Failed to list DeepSeek Harness models'
                    }
                }
            }
        )

        if (opts.model || opts.modelReasoningEffort) {
            const selectedModel = opts.model
                ? opts.model === currentSelection.model
                    ? resolveRequestedModel(`${currentSelection.provider}/${currentSelection.model}`, catalog.models)
                    : resolveRequestedModel(opts.model, catalog.models)
                : resolveRequestedModel(`${currentSelection.provider}/${currentSelection.model}`, catalog.models)
            currentSelection = await client.selectModel({
                sessionId: nativeSessionId,
                provider: selectedModel.provider,
                model: selectedModel.model,
                ...(opts.modelReasoningEffort ? { reasoningEffort: opts.modelReasoningEffort } : {})
            })
            currentModel = currentSelection.model
            currentReasoningEffort = currentSelection.reasoningEffort ?? null
        }

        if (shouldApplyDshPermissionPreset(opts.permissionMode, projectedPermission)) {
            await client.setPermissionPreset(nativeSessionId, opts.permissionMode)
            currentPermissionMode = opts.permissionMode
        }

        registerSessionConfigRpc<DshPermissionMode>({
            rpcHandlerManager: session.rpcHandlerManager,
            flavor: 'dsh',
            modelMode: 'nullable',
            modelReasoningEffortMode: 'nullable',
            onApply: async (config) => {
                if (config.permissionMode !== undefined) {
                    const targetPermissionMode = config.permissionMode === 'default'
                        ? nativeDefaultPermissionMode
                        : config.permissionMode
                    if (!targetPermissionMode) {
                        throw new Error('DeepSeek Harness default permission preset is unavailable')
                    }
                    if (targetPermissionMode !== currentPermissionMode) {
                        await client.setPermissionPreset(nativeSessionId!, targetPermissionMode)
                    }
                    currentPermissionMode = targetPermissionMode
                }
                if (config.model !== undefined || config.modelReasoningEffort !== undefined) {
                    const latest = await client.getModels(nativeSessionId!)
                    const requestedModel = config.model ?? currentSelection?.model ?? latest.current.model
                    const selectedModel = resolveRequestedModel(
                        requestedModel,
                        latest.models,
                        currentSelection?.provider ?? latest.current.provider
                    )
                    currentSelection = await client.selectModel({
                        sessionId: nativeSessionId!,
                        provider: selectedModel.provider,
                        model: selectedModel.model,
                        ...(config.modelReasoningEffort
                            ? { reasoningEffort: config.modelReasoningEffort }
                            : {})
                    })
                    currentModel = currentSelection.model
                    currentReasoningEffort = currentSelection.reasoningEffort ?? null
                }
            },
            onAfterApply: syncKeepAlive,
            appliedFallback: () => ({
                permissionMode: currentPermissionMode,
                model: currentModel,
                modelReasoningEffort: currentReasoningEffort
            })
        })

        session.rpcHandlerManager.registerHandler<PermissionResponseMessage, void>(
            RPC_METHODS.Permission,
            async (response) => {
                const question = pendingQuestions.get(response.id)
                if (question) {
                    pendingQuestions.delete(response.id)
                    const answers = response.answers
                    thinking = true
                    syncKeepAlive()
                    try {
                        await client.respond(question.rpcId, {
                            sessionId: nativeSessionId,
                            answer: dshAnswerFromHapi(question.questions, answers)
                        })
                        session.updateAgentState((state) => {
                            const { [response.id]: _, ...requests } = state.requests ?? {}
                            return {
                                ...state,
                                requests,
                                completedRequests: {
                                    ...state.completedRequests,
                                    [response.id]: {
                                        tool: 'ask_user_question',
                                        arguments: toHapiQuestionInput(question.questions),
                                        createdAt: question.createdAt,
                                        completedAt: Date.now(),
                                        status: 'approved',
                                        decision: 'approved',
                                        answers
                                    }
                                }
                            }
                        })
                    } catch (error) {
                        session.updateAgentState((state) => {
                            const { [response.id]: _, ...requests } = state.requests ?? {}
                            return {
                                ...state,
                                requests,
                                completedRequests: {
                                    ...state.completedRequests,
                                    [response.id]: {
                                        tool: 'ask_user_question',
                                        arguments: toHapiQuestionInput(question.questions),
                                        createdAt: question.createdAt,
                                        completedAt: Date.now(),
                                        status: 'canceled',
                                        reason: error instanceof Error ? error.message : String(error),
                                        decision: 'abort',
                                        answers
                                    }
                                }
                            }
                        })
                        throw error
                    }
                    return
                }
                const pending = pendingApprovals.get(response.id)
                if (!pending) return
                const outcome = response.approved ? 'allowed-once' : 'rejected'
                await client.respond(pending.rpcId, {
                    sessionId: nativeSessionId,
                    approvalId: response.id,
                    outcome
                })
                if (response.decision === 'abort') await client.cancel(nativeSessionId!)
            }
        )

        session.rpcHandlerManager.registerHandler(RPC_METHODS.Abort, async () => {
            if (!nativeSessionId) return
            await client.cancel(nativeSessionId)
            thinking = false
            syncKeepAlive()
            session.sendSessionEvent({ type: 'ready' })
        })

        const submitSteer = async (text: string, localId?: string): Promise<void> => {
            const requestedRpcId = randomUUID()
            ownedRpcIds.add(requestedRpcId)
            const completion = new Promise<void>((resolve, reject) => {
                pendingTurns.set(requestedRpcId, { userSeen: false, resolve, reject })
            })
            try {
                const { rpcId, command } = await client.prompt({
                    sessionId: nativeSessionId!,
                    text,
                    mode: 'steer',
                    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    rpcId: requestedRpcId
                })
                if (localId) session.emitMessagesConsumed([localId])
                if (command) {
                    pendingTurns.delete(rpcId)
                    ownedRpcIds.delete(rpcId)
                    if (command.text) session.sendSessionEvent({ type: 'message', message: command.text })
                    return
                }
                void completion.then(
                    () => ownedRpcIds.delete(rpcId),
                    (error) => {
                        ownedRpcIds.delete(rpcId)
                        logger.debug('[dsh] Steered prompt completion failed:', error)
                    }
                )
            } catch (error) {
                pendingTurns.delete(requestedRpcId)
                ownedRpcIds.delete(requestedRpcId)
                throw error
            }
        }

        session.rpcHandlerManager.registerHandler(RPC_METHODS.SteerQueuedMessage, async (payload: unknown) => {
            const localId = isRecord(payload) && typeof payload.localId === 'string'
                ? payload.localId
                : null
            if (!localId) return { steered: false, error: 'localId is required' }
            if (!thinking) return { steered: false, error: 'Session is not running a turn' }

            const queued = queue.queue.find((item) => item.localId === localId)
            if (!queued || !queue.cancelByLocalId(localId)) {
                return { steered: false, error: 'Message not found or already dispatched' }
            }

            try {
                await submitSteer(queued.message, localId)
                return { steered: true }
            } catch (error) {
                queue.unshift(queued.message, queued.mode, localId)
                return {
                    steered: false,
                    error: error instanceof Error ? error.message : 'DeepSeek Harness steer failed'
                }
            }
        })

        session.onCancelQueuedMessage((localId) => queue.cancelByLocalId(localId))
        session.onUserMessage((message, localId) => {
            const text = formatMessageWithAttachments(message.content.text, message.content.attachments)
            const deliveryMode = message.meta?.deliveryMode ?? 'queue'
            if (thinking && deliveryMode === 'steer') {
                void submitSteer(text, localId).catch((error) => {
                    logger.debug('[dsh] Native steer submission failed; restoring queue item:', error)
                    queue.unshift(text, { deliveryMode }, localId)
                })
                return
            }
            queue.push(text, { deliveryMode }, localId)
        })

        syncKeepAlive()
        keepAliveInterval = setInterval(syncKeepAlive, 2_000)
        session.sendSessionEvent({ type: 'ready' })

        while (!stopped && !loopAbort.signal.aborted) {
            const batch = await queue.waitForMessagesAndGetAsString(loopAbort.signal)
            if (!batch) break

            try {
                const requestedRpcId = randomUUID()
                ownedRpcIds.add(requestedRpcId)
                const completion = new Promise<void>((resolve, reject) => {
                    pendingTurns.set(requestedRpcId, { userSeen: false, resolve, reject })
                })
                const { rpcId, command } = await client.prompt({
                    sessionId: nativeSessionId,
                    text: batch.message,
                    mode: batch.mode.deliveryMode,
                    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    rpcId: requestedRpcId
                })
                session.emitMessagesConsumed(batch.items.flatMap((item) => item.localId ? [item.localId] : []))
                if (command) {
                    pendingTurns.delete(rpcId)
                    ownedRpcIds.delete(rpcId)
                    if (command.text) session.sendSessionEvent({ type: 'message', message: command.text })
                    thinking = false
                    syncKeepAlive()
                    session.sendSessionEvent({ type: 'ready' })
                    continue
                }
                thinking = true
                syncKeepAlive()

                await completion
                ownedRpcIds.delete(rpcId)
            } catch (error) {
                for (const rpcId of ownedRpcIds) {
                    if (!pendingTurns.has(rpcId)) continue
                    pendingTurns.delete(rpcId)
                    ownedRpcIds.delete(rpcId)
                }
                for (let index = batch.items.length - 1; index >= 0; index -= 1) {
                    const item = batch.items[index]!
                    if (batch.isolate) queue.unshiftIsolated(item.message, batch.mode, item.localId)
                    else queue.unshift(item.message, batch.mode, item.localId)
                }
                throw error
            }
        }

        if (!stopped && loopAbort.signal.aborted) {
            throw loopAbort.signal.reason instanceof Error
                ? loopAbort.signal.reason
                : new Error('DeepSeek Harness event stream stopped')
        }
    } catch (error) {
        lifecycle.markCrash(error)
        session.sendSessionEvent({
            type: 'error',
            message: error instanceof Error ? error.message : 'DeepSeek Harness session failed'
        })
        await lifecycle.cleanup()
        throw error
    }
}
