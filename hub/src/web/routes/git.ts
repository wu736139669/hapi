import { Hono } from 'hono'
import { isWildcardSearch, matchesSearchQuery, toSearchGlob } from '@hapi/protocol'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'
import { IMMUTABLE_MEDIA_CACHE_CONTROL as GENERATED_IMAGE_CACHE_CONTROL, ifNoneMatchMatches } from '../mediaCache'

const fileSearchSchema = z.object({
    query: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional()
})

const directorySchema = z.object({
    path: z.string().optional()
})

const filePathSchema = z.object({
    path: z.string().min(1)
})

const generatedImageSchema = z.object({
    imageId: z.string().min(1)
})

function normalizeFileSearchPath(path: string): string {
    return path.replaceAll('\\', '/')
}

function isWindowsSessionPath(path: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

function parseBooleanParam(value: string | undefined): boolean | undefined {
    if (value === 'true') return true
    if (value === 'false') return false
    return undefined
}

async function runRpc<T>(fn: () => Promise<T>): Promise<T | { success: false; error: string }> {
    try {
        return await fn()
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
}

/** One hub→CLI slice per streaming step; keeps slow-runner transfers inside RPC/idle budgets. */
const GENERATED_MEDIA_CHUNK_BYTES = 1024 * 1024


export function createGitRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions/:id/git-status', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const result = await runRpc(() => engine.getGitStatus(sessionResult.sessionId, sessionPath))
        return c.json(result)
    })

    app.get('/sessions/:id/git-diff-numstat', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const staged = parseBooleanParam(c.req.query('staged'))
        const result = await runRpc(() => engine.getGitDiffNumstat(sessionResult.sessionId, { cwd: sessionPath, staged }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-diff-file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = filePathSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid file path' }, 400)
        }

        const staged = parseBooleanParam(c.req.query('staged'))
        const result = await runRpc(() => engine.getGitDiffFile(sessionResult.sessionId, {
            cwd: sessionPath,
            filePath: parsed.data.path,
            staged
        }))
        return c.json(result)
    })

    app.get('/sessions/:id/file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = filePathSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid file path' }, 400)
        }

        const result = await runRpc(() => engine.readSessionFile(sessionResult.sessionId, parsed.data.path))
        return c.json(result)
    })

    app.get('/sessions/:id/generated-images/:imageId', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const parsed = generatedImageSchema.safeParse(c.req.param())
        if (!parsed.success) {
            return c.json({ error: 'Invalid generated image id' }, 400)
        }

        // The id is an immutable content fingerprint, so it doubles as the ETag. If the client
        // already holds it, answer 304 *before* the RPC so revalidation skips the CLI round-trip
        // entirely (and still works even if the image was evicted from CLI memory). Issue #927.
        const etag = `"${parsed.data.imageId}"`
        if (ifNoneMatchMatches(c.req.header('if-none-match'), etag)) {
            return c.body(null, 304, {
                'Cache-Control': GENERATED_IMAGE_CACHE_CONTROL,
                ETag: etag
            })
        }

        const sessionId = sessionResult.sessionId
        const imageId = parsed.data.imageId

        // The first bounded chunk doubles as a probe: it carries total size + mime. Larger
        // media is then streamed chunk by chunk instead of one tens-of-MB socket ack, so a
        // remote runner on a slow tunnel cannot trip RPC/idle timeouts mid-transfer.
        let probe: Awaited<ReturnType<SyncEngine['readGeneratedImageChunk']>>
        try {
            probe = await engine.readGeneratedImageChunk(sessionId, imageId, 0, GENERATED_MEDIA_CHUNK_BYTES)
        } catch (error) {
            return c.json({ success: false, error: error instanceof Error ? error.message : String(error) }, 404)
        }
        if (!probe.success || typeof probe.content !== 'string') {
            return c.json({ success: false, error: probe.error ?? 'Generated image not found' }, 404)
        }
        if (typeof probe.size !== 'number') {
            // Pre-chunk CLI (session process started before the streaming deploy):
            // the probe is actually the whole payload — serve it in one response.
            const bytes = Uint8Array.from(Buffer.from(probe.content, 'base64'))
            const legacyMimeType = probe.mimeType ?? 'application/octet-stream'
            const legacyDisposition = !probe.mimeType || legacyMimeType.startsWith('image/') || legacyMimeType.startsWith('video/') || legacyMimeType.startsWith('audio/')
                ? 'inline'
                : 'attachment'
            return c.body(bytes, 200, {
                'Content-Type': legacyMimeType,
                'Content-Disposition': `${legacyDisposition}; filename="${encodeURIComponent(probe.fileName ?? 'generated-media')}"`,
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': GENERATED_IMAGE_CACHE_CONTROL,
                ETag: etag
            })
        }
        const total = probe.size
        if (total <= 0) {
            return c.json({ success: false, error: 'Generated media is empty' }, 404)
        }
        const mimeType = probe.mimeType ?? 'application/octet-stream'
        const disposition = !probe.mimeType || mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/')
            ? 'inline'
            : 'attachment'

        // Range support so big media can be seeked/resumed by players and download tools.
        let start = 0
        let end = total - 1
        let status: 200 | 206 = 200
        const rangeHeader = c.req.header('range')
        if (rangeHeader) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
            const rawStart = match?.[1] ?? null
            const rawEnd = match?.[2] ?? null
            if (!match || (rawStart === '' && rawEnd === '')) {
                return c.body(null, 416, { 'Content-Range': `bytes */${total}` })
            }
            if (rawStart === '') {
                const suffix = Number(rawEnd)
                if (!Number.isFinite(suffix) || suffix <= 0) {
                    return c.body(null, 416, { 'Content-Range': `bytes */${total}` })
                }
                start = Math.max(0, total - suffix)
            } else {
                start = Number(rawStart)
                if (rawEnd !== '') {
                    end = Number(rawEnd)
                }
            }
            if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
                return c.body(null, 416, { 'Content-Range': `bytes */${total}` })
            }
            end = Math.min(end, total - 1)
            status = 206
        }
        const contentLength = end - start + 1
        const probeBytes = Uint8Array.from(Buffer.from(probe.content, 'base64'))

        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                try {
                    let cursor = start
                    if (cursor < probeBytes.byteLength) {
                        const sliceEnd = Math.min(probeBytes.byteLength, end + 1)
                        if (sliceEnd > cursor) {
                            controller.enqueue(probeBytes.subarray(cursor, sliceEnd))
                            cursor = sliceEnd
                        }
                    }
                    while (cursor <= end) {
                        const chunk = await engine.readGeneratedImageChunk(sessionId, imageId, cursor, GENERATED_MEDIA_CHUNK_BYTES)
                        if (!chunk.success || typeof chunk.content !== 'string') {
                            throw new Error(chunk.error ?? 'Generated media read failed')
                        }
                        const bytes = Uint8Array.from(Buffer.from(chunk.content, 'base64'))
                        if (bytes.byteLength === 0) {
                            break
                        }
                        const remaining = end - cursor + 1
                        const slice = bytes.byteLength > remaining ? bytes.subarray(0, remaining) : bytes
                        controller.enqueue(slice)
                        cursor += slice.byteLength
                    }
                    controller.close()
                } catch (error) {
                    controller.error(error instanceof Error ? error : new Error(String(error)))
                }
            }
        })

        // Generated images are content-addressed by an immutable random id, so the bytes for a
        // given id never change. Cache aggressively so remounts/scroll/session reopen don't
        // re-run the full HTTP -> socket.io RPC -> base64 round-trip every time (issue #927).
        return c.body(stream, status, {
            'Content-Type': mimeType,
            'Content-Disposition': `${disposition}; filename="${encodeURIComponent(probe.fileName ?? 'generated-media')}"`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': GENERATED_IMAGE_CACHE_CONTROL,
            ETag: etag,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(contentLength),
            ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {})
        })
    })

    app.get('/sessions/:id/files', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = fileSearchSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const query = parsed.data.query?.trim() ?? ''
        // ripgrep's gitignore-style globs use '/' as the path separator even on Windows.
        // Accept the native separator users see in Windows paths before building the glob.
        const normalizedQuery = isWindowsSessionPath(sessionPath)
            ? normalizeFileSearchPath(query)
            : query
        const limit = parsed.data.limit ?? 200
        const args = ['--files']
        if (normalizedQuery && !isWildcardSearch(normalizedQuery)) {
            args.push('--iglob', toSearchGlob(normalizedQuery))
        }

        const result = await runRpc(() => engine.runRipgrep(
            sessionResult.sessionId,
            args,
            sessionPath,
            { query: normalizedQuery, limit }
        ))
        if (!result.success) {
            return c.json({ success: false, error: result.error ?? 'Failed to list files' })
        }

        const stdout = result.stdout ?? ''
        const normalizePath = isWindowsSessionPath(sessionPath)
            ? normalizeFileSearchPath
            : (path: string) => path
        const paths = stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map(normalizePath)
            .filter((path) => !normalizedQuery || matchesSearchQuery(path, normalizedQuery))
            .slice(0, limit)

        const metadataResult = await runRpc(() => engine.statFiles(sessionResult.sessionId, paths))
        const metadataByPath = new Map(
            metadataResult.success
                ? (metadataResult.entries ?? []).map((entry) => [entry.path, entry] as const)
                : []
        )

        const files = paths.map((fullPath) => {
            const parts = fullPath.split('/')
            const fileName = parts[parts.length - 1] || fullPath
            const filePath = parts.slice(0, -1).join('/')
            const metadata = metadataByPath.get(fullPath)
            return {
                fileName,
                filePath,
                fullPath,
                fileType: 'file' as const,
                size: metadata?.size,
                modified: metadata?.modified
            }
        })

        return c.json({ success: true, files })
    })

    app.get('/sessions/:id/directory', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = directorySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const path = parsed.data.path ?? ''
        const result = await runRpc(() => engine.listDirectory(sessionResult.sessionId, path))
        return c.json(result)
    })

    return app
}
