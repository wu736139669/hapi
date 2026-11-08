import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OutgoingMessageQueue } from './OutgoingMessageQueue'
import { hasUsageSignal, TranscriptUsageIndex } from './transcriptUsage'

function assistantLine(id: string, usage: Record<string, number>): string {
    return JSON.stringify({
        type: 'assistant',
        message: { id, role: 'assistant', usage }
    }) + '\n'
}

function assistantLog(id: string, usage?: Record<string, number>) {
    return { type: 'assistant' as const, message: { id, usage } }
}

describe('TranscriptUsageIndex', () => {
    it('patches an all-zero stream-json usage from the transcript sample', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-usage-'))
        const index = new TranscriptUsageIndex(dir, 'session-1')
        const path = join(dir, 'session-1.jsonl')
        appendFileSync(path, assistantLine('msg-1', {
            input_tokens: 1200,
            output_tokens: 30,
            cache_read_input_tokens: 170000,
            cache_creation_input_tokens: 0
        }))

        const log = assistantLog('msg-1', {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            context_window: 800000
        })

        expect(index.patch(log)).toBe(true)
        expect(log.message.usage).toMatchObject({
            input_tokens: 1200,
            output_tokens: 30,
            cache_read_input_tokens: 170000,
            context_window: 800000
        })
    })

    it('leaves an authoritative usage sample untouched', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-usage-'))
        const index = new TranscriptUsageIndex(dir, 'session-1')
        appendFileSync(join(dir, 'session-1.jsonl'), assistantLine('msg-1', { input_tokens: 9 }))

        const log = assistantLog('msg-1', { input_tokens: 42, output_tokens: 7 })
        expect(index.patch(log)).toBe(false)
        expect(log.message.usage?.input_tokens).toBe(42)
    })

    it('waits for a partially flushed transcript line', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-usage-'))
        const index = new TranscriptUsageIndex(dir, 'session-1')
        const path = join(dir, 'session-1.jsonl')
        const line = assistantLine('msg-1', { input_tokens: 5 })
        appendFileSync(path, line.slice(0, line.length - 10))

        const log = assistantLog('msg-1', { input_tokens: 0 })
        expect(index.patch(log)).toBe(false)

        appendFileSync(path, line.slice(line.length - 10))
        expect(index.patch(log)).toBe(true)
        expect(log.message.usage?.input_tokens).toBe(5)
    })

    it('switches to a resumed session transcript without replaying history', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-usage-'))
        writeFileSync(join(dir, 'session-2.jsonl'), assistantLine('old-msg', { input_tokens: 7 }))
        const index = new TranscriptUsageIndex(dir, 'session-2')
        appendFileSync(join(dir, 'session-2.jsonl'), assistantLine('new-msg', { input_tokens: 11 }))

        expect(index.patch(assistantLog('old-msg', { input_tokens: 0 }))).toBe(false)
        expect(index.patch(assistantLog('new-msg', { input_tokens: 0 }))).toBe(true)
    })

    it('patches before the delayed outgoing queue sends', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-usage-'))
        const index = new TranscriptUsageIndex(dir, 'session-1')
        const sent: ReturnType<typeof assistantLog>[] = []
        const queue = new OutgoingMessageQueue((logMessage) => {
            index.patch(logMessage)
            sent.push(logMessage as ReturnType<typeof assistantLog>)
        })

        const log = {
            ...assistantLog('msg-1', { input_tokens: 0, output_tokens: 0 }),
            message: {
                ...assistantLog('msg-1').message,
                content: [{ type: 'text', text: 'hello' }],
                usage: { input_tokens: 0, output_tokens: 0 }
            }
        }
        queue.enqueue(log, { delay: 200 })
        setTimeout(() => {
            appendFileSync(join(dir, 'session-1.jsonl'), assistantLine('msg-1', {
                input_tokens: 120,
                cache_read_input_tokens: 8000
            }))
        }, 60)

        await new Promise((resolve) => setTimeout(resolve, 350))
        expect(sent).toHaveLength(1)
        expect(sent[0]!.message.usage).toMatchObject({ input_tokens: 120, cache_read_input_tokens: 8000 })
    })
})

describe('hasUsageSignal', () => {
    it('treats only positive token counts as real samples', () => {
        expect(hasUsageSignal(undefined)).toBe(false)
        expect(hasUsageSignal({ input_tokens: 0, output_tokens: 0 })).toBe(false)
        expect(hasUsageSignal({ cache_read_input_tokens: 1 })).toBe(true)
        expect(hasUsageSignal({ output_tokens: 3 })).toBe(true)
    })
})
