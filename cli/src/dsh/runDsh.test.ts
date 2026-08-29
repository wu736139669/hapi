import { describe, expect, it } from 'vitest'
import {
    dshAnswerFromHapi,
    parseDshQuestions,
    questionFingerprint,
    resolveDshQuestionRequest,
    shouldApplyDshPermissionPreset,
    toHapiQuestionInput
} from './runDsh'

describe('DeepSeek Harness permission preset resume', () => {
    it('does not resend the permission command when the native preset already matches', () => {
        expect(shouldApplyDshPermissionPreset('danger-full-access', 'danger-full-access')).toBe(false)
        expect(shouldApplyDshPermissionPreset('workspace-write', 'workspace-write')).toBe(false)
        expect(shouldApplyDshPermissionPreset('read-only', 'read-only')).toBe(false)
    })

    it('applies a requested preset when the native preset differs or is unavailable', () => {
        expect(shouldApplyDshPermissionPreset('danger-full-access', 'workspace-write')).toBe(true)
        expect(shouldApplyDshPermissionPreset('danger-full-access', null)).toBe(true)
    })

    it('leaves the native preset unchanged when HAPI requests the default mode', () => {
        expect(shouldApplyDshPermissionPreset('default', 'danger-full-access')).toBe(false)
        expect(shouldApplyDshPermissionPreset(undefined, 'danger-full-access')).toBe(false)
    })
})

describe('DeepSeek Harness user questions', () => {
    const questions = parseDshQuestions([{
        id: 'audience',
        header: '发送对象',
        question: '这条站内信发给谁？',
        detail: '选择最适合的受众。',
        multi_select: true,
        options: [
            { label: 'App 终端用户', description: '面向创作者' },
            { label: '同事/内部群', description: '面向内部协作' }
        ]
    }])

    it('preserves DSH ids, details, options and multi-select input', () => {
        expect(questions).toEqual([{
            id: 'audience',
            header: '发送对象',
            question: '这条站内信发给谁？',
            detail: '选择最适合的受众。',
            multiSelect: true,
            options: [
                { label: 'App 终端用户', description: '面向创作者' },
                { label: '同事/内部群', description: '面向内部协作' }
            ]
        }])
        expect(toHapiQuestionInput(questions)).toMatchObject({
            questions: [{ id: 'audience', multiSelect: true }]
        })
    })

    it('maps HAPI index-keyed answers back to DSH stable question ids', () => {
        expect(dshAnswerFromHapi(questions, { '0': ['App 终端用户'] })).toEqual({
            answers: [{ id: 'audience', selected: ['App 终端用户'] }]
        })
    })

    it('separates a custom answer from selected option labels', () => {
        expect(dshAnswerFromHapi(questions, {
            audience: ['同事/内部群', '同时发给运营']
        })).toEqual({
            answers: [{
                id: 'audience',
                selected: ['同事/内部群'],
                custom: '同时发给运营'
            }]
        })
    })

    it('encodes a skipped DSH question as an empty selection', () => {
        expect(dshAnswerFromHapi(questions, { audience: [] })).toEqual({
            answers: [{ id: 'audience', selected: [] }]
        })
    })

    it('uses the matching tool call id and reuses a pending request after reconnect', () => {
        const fingerprint = questionFingerprint(questions)
        const toolCalls = new Map<string, string>([[fingerprint, 'tool-call-1']])
        expect(resolveDshQuestionRequest(
            questions,
            'rpc-1',
            toolCalls,
            new Map(),
            100
        )).toEqual({ requestId: 'tool-call-1', createdAt: 100 })

        expect(resolveDshQuestionRequest(
            questions,
            'rpc-2',
            new Map(),
            new Map([[fingerprint, { id: 'existing-request', createdAt: 42 }]]),
            200
        )).toEqual({ requestId: 'existing-request', createdAt: 42 })
    })
})
