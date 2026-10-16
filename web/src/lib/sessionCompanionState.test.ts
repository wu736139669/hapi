import { describe, expect, it } from 'vitest'
import { toSessionSummary } from '@hapi/protocol'
import type { Session } from '@/types/api'
import { getSessionCompanionState } from './sessionCompanionState'

const session: Session = {
    id: 'forest-state', namespace: 'fixture', seq: 0, createdAt: 0, updatedAt: 0,
    active: true, activeAt: 0, thinking: false, thinkingAt: 0,
    metadata: { path: '/fixture', host: 'fixture', flavor: 'claude' }, metadataVersion: 0,
    agentState: null, agentStateVersion: 0, model: null, effort: null, modelReasoningEffort: null, serviceTier: null,
}

describe('forest companion activity', () => {
    it('does not infer success from idle or disconnected sessions', () => {
        expect(getSessionCompanionState(session)).toBe('idle')
        expect(getSessionCompanionState({ ...session, active: false, thinking: true })).toBe('inactive')
    })

    it('agrees between full chat and summary even when selected or work overlaps requests', () => {
        const pending: Session = { ...session, agentState: { requests: { p: { tool: 'Bash', arguments: { command: 'pwd' } } } } }
        expect(getSessionCompanionState(pending)).toBe('permission')
        expect(getSessionCompanionState(toSessionSummary(pending))).toBe('permission')
        expect(getSessionCompanionState({ ...pending, thinking: true })).toBe('working')
    })

    it('distinguishes questions from approvals and background activity', () => {
        const question: Session = { ...session, agentState: { requests: { q: { tool: 'request_user_input', arguments: {} } } } }
        expect(getSessionCompanionState(question)).toBe('input')
        expect(getSessionCompanionState(toSessionSummary(question))).toBe('input')
        expect(getSessionCompanionState({ ...session, backgroundTaskCount: 1 })).toBe('background')
    })
})
