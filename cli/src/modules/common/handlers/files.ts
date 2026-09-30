import { logger } from '@/ui/logger'
import { readFile, stat, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { resolve } from 'path'
import type { FileReadResponse, GeneratedImageResponse } from '@hapi/protocol/apiTypes'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { getGeneratedImage } from '../generatedImages'
import { getErrorMessage, rpcError } from '../rpcResponses'

interface ReadFileRequest {
    path: string
}

type ReadFileResponse = FileReadResponse

interface ReadGeneratedImageRequest {
    id: string
    /** Optional slice start; the hub streams large media in bounded chunks. */
    offset?: number
    length?: number
}

type ReadGeneratedImageResponse = GeneratedImageResponse

/** Cap one chunk so a single RPC ack stays small on slow runner links. */
const MAX_GENERATED_IMAGE_CHUNK_BYTES = 4 * 1024 * 1024

interface WriteFileRequest {
    path: string
    content: string
    expectedHash?: string | null
}

interface WriteFileResponse {
    success: boolean
    hash?: string
    error?: string
}

export function registerFileHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<ReadFileRequest, ReadFileResponse>(RPC_METHODS.ReadFile, async (data) => {
        logger.debug('Read file request:', data.path)

        const validation = validatePath(data.path, workingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path')
        }

        try {
            const resolvedPath = resolve(workingDirectory, data.path)
            const stats = await stat(resolvedPath)
            const buffer = await readFile(resolvedPath)
            const content = buffer.toString('base64')
            return {
                success: true,
                content,
                size: stats.size,
                modified: stats.mtime.getTime()
            }
        } catch (error) {
            logger.debug('Failed to read file:', error)
            return rpcError(getErrorMessage(error, 'Failed to read file'))
        }
    })

    rpcHandlerManager.registerHandler<ReadGeneratedImageRequest, ReadGeneratedImageResponse>(RPC_METHODS.ReadGeneratedImage, async (data) => {
        logger.debug('Read generated image request:', data.id)

        const image = getGeneratedImage(data.id)
        if (!image) {
            return rpcError('Generated image not found')
        }

        try {
            const total = image.content.byteLength
            const hasSlice = typeof data.offset === 'number' || typeof data.length === 'number'
            if (!hasSlice) {
                return {
                    success: true,
                    content: image.content.toString('base64'),
                    mimeType: image.mimeType,
                    fileName: image.fileName,
                    size: total
                }
            }

            const offset = Number.isFinite(data.offset) ? Math.max(0, Math.floor(data.offset as number)) : 0
            if (offset > total) {
                return rpcError('Chunk offset is past the end of the media')
            }
            const requested = Number.isFinite(data.length) && (data.length as number) > 0
                ? Math.floor(data.length as number)
                : MAX_GENERATED_IMAGE_CHUNK_BYTES
            const length = Math.min(requested, MAX_GENERATED_IMAGE_CHUNK_BYTES, total - offset)
            const slice = image.content.subarray(offset, offset + length)
            return {
                success: true,
                content: slice.toString('base64'),
                mimeType: image.mimeType,
                fileName: image.fileName,
                size: total,
                offset,
                length
            }
        } catch (error) {
            logger.debug('Failed to read generated image:', error)
            return rpcError(getErrorMessage(error, 'Failed to read generated image'))
        }
    })

    rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>(RPC_METHODS.WriteFile, async (data) => {
        logger.debug('Write file request:', data.path)

        const validation = validatePath(data.path, workingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path')
        }

        try {
            if (data.expectedHash !== null && data.expectedHash !== undefined) {
                try {
                    const existingBuffer = await readFile(data.path)
                    const existingHash = createHash('sha256').update(existingBuffer).digest('hex')

                    if (existingHash !== data.expectedHash) {
                        return rpcError(`File hash mismatch. Expected: ${data.expectedHash}, Actual: ${existingHash}`)
                    }
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                    return rpcError('File does not exist but hash was provided')
                }
            } else {
                try {
                    await stat(data.path)
                    return rpcError('File already exists but was expected to be new')
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                }
            }

            const buffer = Buffer.from(data.content, 'base64')
            await writeFile(data.path, buffer)

            const hash = createHash('sha256').update(buffer).digest('hex')

            return { success: true, hash }
        } catch (error) {
            logger.debug('Failed to write file:', error)
            return rpcError(getErrorMessage(error, 'Failed to write file'))
        }
    })
}
