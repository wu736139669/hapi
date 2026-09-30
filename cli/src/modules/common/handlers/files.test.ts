import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { RpcHandlerManager } from '../../../api/rpc/RpcHandlerManager'
import { registerFileHandlers } from './files'
import { registerGeneratedImage } from '../generatedImages'

async function createTempDir(prefix: string): Promise<string> {
    const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(path, { recursive: true })
    return path
}

describe('file RPC handlers', () => {
    let rootDir: string
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        rootDir = await createTempDir('hapi-file-handler')
        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerFileHandlers(rpc, rootDir)
    })

    afterEach(async () => {
        await rm(rootDir, { recursive: true, force: true })
    })

    it('returns file metadata alongside content', async () => {
        const filePath = join(rootDir, 'README.md')
        await writeFile(filePath, '# test')
        const expectedStats = await stat(filePath)

        const response = await rpc.handleRequest({
            method: 'session-test:readFile',
            params: JSON.stringify({ path: 'README.md' })
        })
        const parsed = JSON.parse(response) as {
            success: boolean
            content?: string
            size?: number
            modified?: number
        }

        expect(parsed.success).toBe(true)
        expect(parsed.content).toBe(Buffer.from('# test').toString('base64'))
        expect(parsed.size).toBe(expectedStats.size)
        expect(parsed.modified).toBe(expectedStats.mtime.getTime())
    })

    it('reads generated media whole or sliced, and reports the total size', async () => {
        const payload = Buffer.from('0123456789')
        registerGeneratedImage({ id: 'media-1', path: 'media.bin', mimeType: 'application/octet-stream', bytes: payload })

        const full = JSON.parse(await rpc.handleRequest({
            method: 'session-test:readGeneratedImage',
            params: JSON.stringify({ id: 'media-1' })
        })) as { success: boolean; content?: string; size?: number }
        expect(full.success).toBe(true)
        expect(full.size).toBe(payload.length)
        expect(full.content).toBe(payload.toString('base64'))

        const chunk = JSON.parse(await rpc.handleRequest({
            method: 'session-test:readGeneratedImage',
            params: JSON.stringify({ id: 'media-1', offset: 2, length: 4 })
        })) as { success: boolean; content?: string; size?: number; offset?: number; length?: number }
        expect(chunk).toMatchObject({
            success: true,
            size: payload.length,
            offset: 2,
            length: 4,
            content: Buffer.from('2345').toString('base64')
        })

        const past = JSON.parse(await rpc.handleRequest({
            method: 'session-test:readGeneratedImage',
            params: JSON.stringify({ id: 'media-1', offset: 99, length: 4 })
        })) as { success: boolean }
        expect(past.success).toBe(false)
    })
})
