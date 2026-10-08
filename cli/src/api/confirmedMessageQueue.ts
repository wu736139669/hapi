type Message = {
    sid: string
    message: unknown
    localId: string
    createdAt?: number
}

type Entry = {
    message: Message
    bytes: number
    replay: boolean
    inFlight: boolean
    failedGeneration?: number
}

const MAX_IN_FLIGHT_BYTES = 256 * 1024
const MAX_IN_FLIGHT_MESSAGES = 16

/** Transcript delivery only; native user submissions remain in the native queue.
 * Bound the socket backlog so pongs, keep-alives and RPC acks can pass between
 * history batches. Only a hub persistence ACK permits forgetting a message. */
export class ConfirmedMessageQueue {
    private readonly pending = new Map<string, Entry>()
    private readonly confirmed = new Set<string>()
    private readonly drainListeners = new Set<(drained: boolean) => void>()
    private readonly progressListeners = new Set<() => void>()
    private connected = false
    private closed = false
    private generation = 0
    private inFlightBytes = 0
    private inFlightMessages = 0

    constructor(
        private readonly send: (message: Message) => Promise<void>,
        private readonly onConfirmed: (localId: string) => void,
        private readonly onError: (error: unknown) => void
    ) {}

    enqueue(message: Message, replay = false, verifyPersistence = false): void {
        // The Hub checkpoint is authoritative after restore/rollback. A
        // process-local confirmation cannot prove that Hub still has a row.
        if (verifyPersistence) this.confirmed.delete(message.localId)
        if (this.closed || this.confirmed.has(message.localId)) return
        const existing = this.pending.get(message.localId)
        if (existing) {
            if (!replay) existing.replay = false
        } else {
            this.pending.set(message.localId, {
                message, replay, inFlight: false,
                bytes: Buffer.byteLength(JSON.stringify(message))
            })
        }
        this.pump()
    }

    setConnected(connected: boolean): void {
        if (this.closed || this.connected === connected) return
        this.connected = connected
        this.generation++
        this.inFlightBytes = 0
        this.inFlightMessages = 0
        for (const entry of this.pending.values()) entry.inFlight = false
        if (connected) this.pump()
    }

    private next(): Entry | undefined {
        let history: Entry | undefined
        for (const entry of this.pending.values()) {
            if (entry.inFlight || entry.failedGeneration === this.generation) continue
            if (!entry.replay) return entry
            history ??= entry
        }
        return history
    }

    private pump(): void {
        while (this.connected && !this.closed && this.inFlightMessages < MAX_IN_FLIGHT_MESSAGES) {
            const entry = this.next()
            if (!entry) return
            // An individual large result may exceed the window; send it alone.
            if (this.inFlightMessages > 0 && this.inFlightBytes + entry.bytes > MAX_IN_FLIGHT_BYTES) return
            const generation = this.generation
            entry.inFlight = true
            this.inFlightBytes += entry.bytes
            this.inFlightMessages++
            void this.send(entry.message).then(() => {
                if (this.closed || generation !== this.generation) return
                this.pending.delete(entry.message.localId)
                this.confirmed.add(entry.message.localId)
                this.onConfirmed(entry.message.localId)
                for (const listener of this.progressListeners) listener()
            }).catch(error => {
                if (this.closed || generation !== this.generation) return
                // A failed ACK is uncertain. Retain it for the next connection,
                // rather than adding retries to an already congested socket.
                entry.failedGeneration = generation
                this.onError(error)
            }).finally(() => {
                if (this.closed || generation !== this.generation) return
                entry.inFlight = false
                this.inFlightBytes -= entry.bytes
                this.inFlightMessages--
                if (this.pending.size === 0) this.notifyDrained(true)
                this.pump()
            })
        }
    }

    drain(timeoutMs: number): Promise<boolean> {
        if (this.closed) return Promise.resolve(false)
        if (this.pending.size === 0) return Promise.resolve(true)
        if (timeoutMs <= 0) return Promise.resolve(false)
        return new Promise(resolve => {
            const finish = (drained: boolean) => {
                clearTimeout(timer)
                this.drainListeners.delete(finish)
                resolve(drained)
            }
            const timer = setTimeout(() => finish(false), timeoutMs)
            this.drainListeners.add(finish)
        })
    }

    /** Wait only for this history batch. Continuous live traffic must not
     * prevent a completed batch from advancing its durable checkpoint. */
    waitFor(localIds: string[], timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
        const confirmed = () => localIds.every(id => this.confirmed.has(id))
        if (this.closed || signal?.aborted) return Promise.resolve(false)
        if (confirmed()) return Promise.resolve(true)
        return new Promise(resolve => {
            const finish = (result: boolean) => {
                clearTimeout(timer); this.progressListeners.delete(check)
                signal?.removeEventListener('abort', aborted); resolve(result)
            }
            const check = () => { if (this.closed) finish(false); else if (confirmed()) finish(true) }
            const aborted = () => finish(false)
            const timer = setTimeout(() => finish(false), timeoutMs)
            this.progressListeners.add(check)
            signal?.addEventListener('abort', aborted, { once: true })
        })
    }

    private notifyDrained(drained: boolean): void {
        for (const listener of this.drainListeners) listener(drained)
    }

    close(): void {
        this.closed = true
        this.pending.clear()
        this.confirmed.clear()
        for (const listener of this.progressListeners) listener()
        this.notifyDrained(false)
    }
}
