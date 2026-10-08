import { describe, expect, it, vi } from 'vitest'
import { ConfirmedMessageQueue } from './confirmedMessageQueue'

function fixture() {
    const attempts: Array<{ id: string; resolve(): void; reject(error: Error): void }> = []
    const confirmed = vi.fn()
    const error = vi.fn()
    const queue = new ConfirmedMessageQueue(message => new Promise<void>((resolve, reject) => {
        attempts.push({ id: message.localId, resolve, reject })
    }), confirmed, error)
    const enqueue = (id: string, bytes = 80_000, replay = true) => queue.enqueue({
        sid: 'sid', localId: id, message: { text: 'x'.repeat(bytes) }
    }, replay)
    return { queue, attempts, confirmed, error, enqueue }
}

describe('confirmed transcript delivery', () => {
    it('confirms a history batch independently of continuous live traffic and allows restored-Hub verification', async () => {
        const f = fixture(); f.queue.setConnected(true)
        f.enqueue('history', 100); f.enqueue('live', 100, false)
        const done = f.queue.waitFor(['history'], 1000)
        f.attempts[0].resolve()
        expect(await done).toBe(true)
        expect(await f.queue.drain(0)).toBe(false)
        f.queue.enqueue({ sid: 'sid', localId: 'history', message: {} }, true, true)
        expect(f.attempts.map(attempt => attempt.id)).toEqual(['history', 'live', 'history'])
        const abort = new AbortController()
        const waiting = f.queue.waitFor(['history'], 1000, abort.signal)
        abort.abort(); expect(await waiting).toBe(false)
        f.queue.close()
    })
    it('bounds a long history and puts live messages ahead of unsent history', async () => {
        const f = fixture()
        f.queue.setConnected(true)
        for (let i = 0; i < 1000; i++) f.enqueue(`history-${i}`)
        expect(f.attempts.map(a => a.id)).toEqual(['history-0', 'history-1', 'history-2'])
        f.enqueue('live', 100, false)
        const drained = f.queue.drain(1000)
        f.attempts[0].resolve()
        await vi.waitFor(() => expect(f.attempts[3]?.id).toBe('live'))
        expect(f.confirmed).toHaveBeenCalledWith('history-0')
        f.queue.close()
        expect(await drained).toBe(false)
    })

    it('retains only unconfirmed messages across reconnect and ignores stale ACKs', async () => {
        const f = fixture()
        f.queue.setConnected(true)
        f.enqueue('confirmed', 100)
        f.enqueue('uncertain', 100)
        f.attempts[0].resolve()
        await vi.waitFor(() => expect(f.confirmed).toHaveBeenCalledWith('confirmed'))
        f.queue.setConnected(false)
        f.attempts[1].resolve()
        await Promise.resolve()
        f.enqueue('confirmed', 100)
        f.enqueue('uncertain', 100)
        f.queue.setConnected(true)
        expect(f.attempts.map(a => a.id)).toEqual(['confirmed', 'uncertain', 'uncertain'])
        expect(f.confirmed).not.toHaveBeenCalledWith('uncertain')
        f.attempts[2].resolve()
        expect(await f.queue.drain(1000)).toBe(true)
        expect(f.confirmed).toHaveBeenCalledWith('uncertain')
        f.queue.close()
    })

    it('does not turn a rejected persistence ACK into confirmation or a retry storm', async () => {
        const f = fixture()
        f.queue.setConnected(true)
        f.enqueue('failed', 100)
        f.attempts[0].reject(new Error('not persisted'))
        await vi.waitFor(() => expect(f.error).toHaveBeenCalledTimes(1))
        expect(f.confirmed).not.toHaveBeenCalled()
        expect(f.attempts).toHaveLength(1)
        expect(await f.queue.drain(0)).toBe(false)
        f.queue.setConnected(false)
        f.queue.setConnected(true)
        expect(f.attempts).toHaveLength(2)
        f.attempts[1].resolve()
        expect(await f.queue.drain(1000)).toBe(true)
        f.queue.close()
    })

    it('sends one oversized result alone and counts UTF-8 bytes rather than characters', async () => {
        const f = fixture()
        f.queue.setConnected(true)
        f.queue.enqueue({ sid: 'sid', localId: 'large', message: '中'.repeat(100_000) }, true)
        f.enqueue('next', 100)
        expect(f.attempts).toHaveLength(1)
        f.attempts[0].resolve()
        await vi.waitFor(() => expect(f.attempts[1]?.id).toBe('next'))
        f.attempts[1].resolve()
        expect(await f.queue.drain(1000)).toBe(true)
        f.queue.close()
    })
})
