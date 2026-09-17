/**
 * Protocol marker for token_count payloads whose input token total already
 * includes cache reads/writes. Consumers must not add cache tokens again.
 */
export const INCLUSIVE_INPUT_TOKEN_USAGE_MARKER = {
    usageSchema: 'hapi.usage.v1',
    inputTokenSemantics: 'includes-cache'
} as const

export type InclusiveInputTokenUsageMarker = typeof INCLUSIVE_INPUT_TOKEN_USAGE_MARKER

/**
 * One absolute per-(day, model) OpenCode token bucket. Produced by the
 * offline usage reconciler (`@hapi/protocol/opencodeUsage`), either by the
 * hub's local scan or by a machine's runner reporting its own OpenCode store
 * over `opencode-usage-report`. Values are totals, never deltas.
 */
export type OpencodeUsageReportRow = {
    day: string
    model: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    requests: number
}

/** One OpenCode session's snapshot inside a machine-level report. */
export type OpencodeUsageSessionReport = {
    opencodeSessionId: string
    rows: OpencodeUsageReportRow[]
}

/** CLI machine → hub `opencode-usage-report` payload. */
export type OpencodeUsageMachineReportPayload = {
    machineId: string
    sessions: OpencodeUsageSessionReport[]
}
