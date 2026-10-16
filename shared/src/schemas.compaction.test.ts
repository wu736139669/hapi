import { describe, expect, it } from 'vitest'
import { AgentStateSchema } from './schemas'

describe('live context compaction state', () => {
    it('preserves the start timestamp and an explicit clear across schema parsing', () => {
        expect(AgentStateSchema.parse({ contextCompactionStartedAt: 1_792_068_848_000 }))
            .toEqual({ contextCompactionStartedAt: 1_792_068_848_000 })
        expect(AgentStateSchema.parse({ contextCompactionStartedAt: null }))
            .toEqual({ contextCompactionStartedAt: null })
    })

    it.each([-1, 1.5, 'now'])('rejects an invalid start time: %s', value => {
        expect(AgentStateSchema.safeParse({ contextCompactionStartedAt: value }).success).toBe(false)
    })
})
