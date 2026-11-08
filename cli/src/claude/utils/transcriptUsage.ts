import { existsSync, openSync, closeSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

type UsageRecord = Record<string, unknown>

/** Any non-zero token field makes a usage sample authoritative. */
export function hasUsageSignal(usage: UsageRecord | null | undefined): boolean {
    if (!usage) return false
    for (const key of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
        const value = usage[key]
        if (typeof value === 'number' && value > 0) return true
    }
    return false
}

function isAssistantLogMessage(value: unknown): value is {
    type: string
    message?: { id?: unknown; usage?: UsageRecord }
} {
    return typeof value === 'object' && value !== null
        && (value as { type?: unknown }).type === 'assistant'
}

/**
 * Claude Code 2.1.3xx writes real per-call `usage` to its transcript but the
 * stream-json `assistant` messages HAPI relays carry all-zero usage (verified
 * with the OpenCode Go gateway: transcript has input/cache tokens, the SDK
 * message has zeros). The transcript entry lands ~100 ms later, so the remote
 * launcher delays zero-usage assistant messages and patches the usage in right
 * before sending.
 *
 * Only the main transcript is read: sidechain usage must not drive the parent
 * context meter, and the reducer already ignores sidechain rows.
 */
export class TranscriptUsageIndex {
    private sessionId: string | null
    /** Bytes already consumed; starts at EOF so resumed history is not re-parsed. */
    private offset: number
    /** Trailing partial line (Claude Code has not flushed the newline yet). */
    private carry = ''
    private usageByMessageId = new Map<string, UsageRecord>()

    constructor(private readonly projectDir: string, sessionId: string | null) {
        this.sessionId = sessionId
        this.offset = this.currentFileSize()
    }

    get path(): string | null {
        return this.sessionId ? join(this.projectDir, `${this.sessionId}.jsonl`) : null
    }

    updateSessionId(sessionId: string | null): void {
        if (sessionId === this.sessionId) return
        this.sessionId = sessionId
        this.offset = this.currentFileSize()
        this.carry = ''
        this.usageByMessageId.clear()
    }

    /**
     * Replace an all-zero assistant usage with the transcript's real sample.
     * Returns true when the message was patched.
     */
    patch(logMessage: unknown): boolean {
        if (!isAssistantLogMessage(logMessage)) return false
        const message = logMessage.message
        if (!message || typeof message.id !== 'string') return false
        const current = message.usage
        if (hasUsageSignal(current)) return false

        const found = this.lookup(message.id)
        if (!found) return false
        message.usage = { ...(current ?? {}), ...found }
        return true
    }

    private lookup(messageId: string): UsageRecord | null {
        const cached = this.usageByMessageId.get(messageId)
        if (cached) return cached
        this.readNewLines()
        return this.usageByMessageId.get(messageId) ?? null
    }

    private currentFileSize(): number {
        const path = this.path
        if (!path) return 0
        try {
            return existsSync(path) ? statSync(path).size : 0
        } catch {
            return 0
        }
    }

    private readNewLines(): void {
        const path = this.path
        if (!path) return
        let size: number
        try {
            size = statSync(path).size
        } catch {
            return
        }
        if (size < this.offset) {
            // Truncated/replaced transcript: start over rather than seeking past EOF.
            this.offset = 0
            this.carry = ''
            this.usageByMessageId.clear()
        }
        if (size === this.offset) return

        const length = size - this.offset
        const buffer = Buffer.allocUnsafe(length)
        let fd: number | null = null
        try {
            fd = openSync(path, 'r')
            const read = readSync(fd, buffer, 0, length, this.offset)
            this.offset += read
            this.consume(buffer.subarray(0, read).toString('utf8'))
        } catch {
            // A transient read error must not break message delivery.
        } finally {
            if (fd !== null) closeSync(fd)
        }
    }

    private consume(chunk: string): void {
        const text = this.carry + chunk
        const lines = text.split('\n')
        this.carry = lines.pop() ?? ''
        for (const line of lines) {
            if (!line.includes('"usage"')) continue
            let entry: any
            try {
                entry = JSON.parse(line)
            } catch {
                continue
            }
            if (entry?.type !== 'assistant') continue
            const message = entry.message
            const id = message?.id
            const usage = message?.usage
            if (typeof id === 'string' && hasUsageSignal(usage)) {
                this.usageByMessageId.set(id, usage)
            }
        }
    }
}
