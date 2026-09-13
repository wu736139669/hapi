import { describe, expect, it } from 'vitest'
import type { NormalizedMessage } from '@/chat/types'
import { getRetryableCodexTurnMessageId } from '@/chat/codexRetry'

function event(id: string, message: string): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        role: 'event',
        isSidechain: false,
        content: { type: 'message', message }
    }
}

function ready(id: string): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        role: 'event',
        isSidechain: false,
        content: { type: 'ready' }
    }
}

function user(id: string): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        role: 'user',
        isSidechain: false,
        content: { type: 'text', text: 'new prompt' }
    }
}

function agent(id: string): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'text', text: 'completed response', uuid: id, parentUUID: null }]
    }
}

describe('getRetryableCodexTurnMessageId', () => {
    it('keeps the action only on the latest capacity error', () => {
        expect(getRetryableCodexTurnMessageId([
            event('capacity-1', 'Task failed: Selected model is at capacity; retrying same conversation (1/3)'),
            event('capacity-2', 'Task failed: Selected model is at capacity; retrying same conversation (2/3)'),
            event('capacity-3', 'Task failed: Selected model is at capacity.')
        ], false)).toBe('agent-event:capacity-3')
    })

    it('keeps the final failure retryable when Codex appends ready', () => {
        expect(getRetryableCodexTurnMessageId([
            event('capacity', 'Task failed: Selected model is at capacity.'),
            ready('ready')
        ], false)).toBe('agent-event:capacity')
    })

    it('removes the action after a successful retry or a new prompt', () => {
        expect(getRetryableCodexTurnMessageId([
            event('capacity', 'Task failed: Selected model is at capacity.'),
            agent('answer')
        ], false)).toBeNull()
        expect(getRetryableCodexTurnMessageId([
            event('capacity', 'Task failed: Selected model is at capacity.'),
            user('next')
        ], false)).toBeNull()
    })

    it('does not expose retry while the same turn is running', () => {
        expect(getRetryableCodexTurnMessageId([
            event('capacity', 'Task failed: Selected model is at capacity.')
        ], true)).toBeNull()
    })
})
