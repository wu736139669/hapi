import { z } from 'zod'

/** Native positions, not Hub arrival sequences. The page containing the
 * anchor turn is deliberately revisited so an active turn can grow. */
export const CodexHistoryCheckpointSchema = z.object({
    version: z.literal(1),
    pageCursor: z.string().nullable(),
    turnId: z.string().nullable(),
    itemId: z.string().nullable(),
    turnComplete: z.boolean()
})
export type CodexHistoryCheckpoint = z.infer<typeof CodexHistoryCheckpointSchema>
export const CodexHistoryStateSchema = z.object({
    epoch: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    checkpoint: CodexHistoryCheckpointSchema.nullable()
})
export type CodexHistoryState = z.infer<typeof CodexHistoryStateSchema>
export const CodexHistorySyncRequestSchema = z.object({
    sid: z.string().min(1),
    threadId: z.string().min(1),
    commit: z.object({
        epoch: z.number().int().nonnegative(),
        revision: z.number().int().nonnegative(),
        checkpoint: CodexHistoryCheckpointSchema.nullable(),
        localIds: z.array(z.string().min(1)).max(1000)
    }).optional()
})
export type CodexHistorySyncRequest = z.infer<typeof CodexHistorySyncRequestSchema>
export type CodexHistorySyncAck = { ok: true; state: CodexHistoryState } | { ok: false }
