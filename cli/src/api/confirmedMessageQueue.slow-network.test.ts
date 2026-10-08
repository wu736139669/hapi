import { createServer } from 'node:http'
import { Server, type Socket as ServerSocket } from 'socket.io'
import { io, type Socket } from 'socket.io-client'
import WebSocket, { WebSocketServer } from 'ws'
import { describe, expect, it } from 'vitest'
import { ConfirmedMessageQueue } from './confirmedMessageQueue'

async function slowConnection() {
    const http = createServer()
    const hub = new Server(http, { path: '/socket.io/', ...{ pingInterval: 1000, pingTimeout: 3000 } })
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
    const address = http.address()
    if (!address || typeof address === 'string') throw new Error('No hub port')
    const proxy = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    await new Promise<void>(resolve => proxy.once('listening', resolve))
    const proxyAddress = proxy.address()
    if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('No proxy port')
    const cleanups: Array<() => void> = []
    let backlogBytes = 0
    let peakBacklogBytes = 0
    proxy.on('connection', (downstream, request) => {
        const upstream = new WebSocket(`ws://127.0.0.1:${address.port}${request.url}`)
        const packets: Array<{ data: Buffer; binary: boolean }> = []
        let timer: ReturnType<typeof setTimeout> | undefined
        let stopped = false
        const pump = () => {
            if (stopped || timer || upstream.readyState !== WebSocket.OPEN) return
            const packet = packets.shift()
            if (!packet) return
            // Throttle the entire uplink, including pongs and RPC replies.
            timer = setTimeout(() => {
                timer = undefined
                backlogBytes -= packet.data.length
                if (upstream.readyState === WebSocket.OPEN) upstream.send(packet.data, { binary: packet.binary })
                pump()
            }, Math.max(1, packet.data.length / (128 * 1024) * 1000))
        }
        upstream.on('open', pump)
        upstream.on('message', (data, binary) => {
            if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary })
        })
        downstream.on('message', (raw, binary) => {
            const data = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw)
            packets.push({ data, binary })
            backlogBytes += data.length
            peakBacklogBytes = Math.max(peakBacklogBytes, backlogBytes)
            pump()
        })
        const stop = () => {
            if (stopped) return
            stopped = true
            clearTimeout(timer)
            downstream.terminate()
            upstream.terminate()
        }
        upstream.on('error', stop)
        downstream.on('error', stop)
        upstream.on('close', stop)
        downstream.on('close', stop)
        cleanups.push(stop)
    })
    const connection = new Promise<ServerSocket>(resolve => hub.once('connection', resolve))
    const socket: Socket = io(`http://127.0.0.1:${proxyAddress.port}`, { transports: ['websocket'], reconnection: false })
    await new Promise<void>(resolve => socket.once('connect', resolve))
    const serverSocket = await connection
    serverSocket.on('message', (_payload: unknown, ack?: (response: { ok: boolean }) => void) => ack?.({ ok: true }))
    socket.on('rpc-request', (ack: (value: string) => void) => ack('ok'))
    return {
        socket, serverSocket, peakBacklog: () => peakBacklogBytes,
        async close() {
            socket.disconnect()
            for (const cleanup of cleanups) cleanup()
            await new Promise<void>(resolve => proxy.close(() => resolve()))
            await new Promise<void>(resolve => hub.close(() => resolve()))
        }
    }
}

describe('transcript delivery over a slow uplink', () => {
    it('reproduces heartbeat failure when a long history floods the socket', async () => {
        const f = await slowConnection()
        try {
            const disconnected = new Promise<void>(resolve => f.socket.once('disconnect', () => resolve()))
            for (let i = 0; i < 1000; i++) f.socket.emit('message', { localId: `${i}`, text: 'x'.repeat(32_000) })
            await disconnected
            expect(f.socket.connected).toBe(false)
            expect(f.peakBacklog()).toBeGreaterThan(1024 * 1024)
        } finally { await f.close() }
    }, 10_000)

    it('keeps heartbeats, RPCs and live content moving during the same history replay', async () => {
        const f = await slowConnection()
        const confirmed: string[] = []
        const queue = new ConfirmedMessageQueue(async payload => {
            const ack: unknown = await f.socket.emitWithAck('message', payload)
            if ((ack as { ok?: boolean })?.ok !== true) throw new Error('Not confirmed')
        }, id => confirmed.push(id), () => {})
        f.socket.on('disconnect', () => queue.setConnected(false))
        queue.setConnected(true)
        try {
            for (let i = 0; i < 1000; i++) queue.enqueue({ sid: 'sid', localId: `history-${i}`, message: 'x'.repeat(32_000) }, true)
            queue.enqueue({ sid: 'sid', localId: 'live', message: 'new response' })
            expect(await f.serverSocket.timeout(2800).emitWithAck('rpc-request')).toBe('ok')
            await new Promise(resolve => setTimeout(resolve, 5000))
            expect(f.socket.connected).toBe(true)
            expect(confirmed).toContain('live')
            expect(confirmed.length).toBeLessThan(1000)
            expect(f.peakBacklog()).toBeLessThan(270 * 1024)
        } finally { queue.close(); await f.close() }
    }, 12_000)
})
