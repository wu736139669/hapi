#!/usr/bin/env bun
/**
 * Manage the hub's durable chat-image attachment store
 * (`~/.hapi/attachments`, table `chat_attachments`).
 *
 * Usage:
 *   bun run hub/scripts/attachments.ts stats
 *   bun run hub/scripts/attachments.ts verify
 *   bun run hub/scripts/attachments.ts gc [--yes]
 *   bun run hub/scripts/attachments.ts export --session <sessionId> --out <dir>
 *
 * - stats   totals for DB rows vs files on disk (orphan/missing counts)
 * - verify  sha256-check every registered file; lists missing/corrupt entries
 * - gc      deletes files on disk that no DB row references (dry-run by default)
 * - export  copies one session's attachments to a directory using their names
 */

import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'

interface Row {
    session_id: string
    id: string
    filename: string
    mime_type: string
    size: number
    sha256: string
    storage_key: string
    created_at: number
}

function hapiHomeDir(): string {
    return process.env.HAPI_HOME || join(homedir(), '.hapi')
}

function attachmentsRoot(): string {
    return join(hapiHomeDir(), 'attachments')
}

function openDb(): Database {
    const dbPath = join(hapiHomeDir(), 'hapi.db')
    return new Database(dbPath, { readonly: true, create: false })
}

async function listFilesOnDisk(): Promise<string[]> {
    const root = attachmentsRoot()
    const keys: string[] = []
    const walk = async (dir: string) => {
        let entries
        try {
            entries = await readdir(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const entry of entries) {
            const full = join(dir, entry.name)
            if (entry.isDirectory()) {
                await walk(full)
            } else if (entry.isFile()) {
                keys.push(relative(root, full))
            }
        }
    }
    await walk(root)
    return keys
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function cmdStats(): Promise<void> {
    const db = openDb()
    try {
        const rows = db.prepare(
            'SELECT session_id, id, filename, mime_type, size, sha256, storage_key, created_at FROM chat_attachments'
        ).all() as Row[]
        const diskKeys = new Set(await listFilesOnDisk())
        const registered = new Set(rows.map((row) => row.storage_key))
        const orphans = [...diskKeys].filter((key) => !registered.has(key))
        const missing = rows.filter((row) => !diskKeys.has(row.storage_key))
        let diskBytes = 0
        for (const key of diskKeys) {
            try {
                diskBytes += (await stat(join(attachmentsRoot(), key))).size
            } catch {
                // raced with manual cleanup
            }
        }
        const totalBytes = rows.reduce((sum, row) => sum + row.size, 0)
        const bySession = new Map<string, { count: number; bytes: number }>()
        for (const row of rows) {
            const entry = bySession.get(row.session_id) ?? { count: 0, bytes: 0 }
            entry.count += 1
            entry.bytes += row.size
            bySession.set(row.session_id, entry)
        }
        const top = [...bySession.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10)

        console.log(`root: ${attachmentsRoot()}`)
        console.log(`registered: ${rows.length} files, ${formatBytes(totalBytes)}`)
        console.log(`on disk:    ${diskKeys.size} files, ${formatBytes(diskBytes)}`)
        console.log(`orphan files (no DB row): ${orphans.length}`)
        console.log(`missing files (row without file): ${missing.length}`)
        if (top.length > 0) {
            console.log('top sessions:')
            for (const [sessionId, entry] of top) {
                console.log(`  ${formatBytes(entry.bytes).padStart(10)}  ${String(entry.count).padStart(4)} files  ${sessionId}`)
            }
        }
    } finally {
        db.close()
    }
}

async function cmdVerify(): Promise<void> {
    const db = openDb()
    try {
        const rows = db.prepare(
            'SELECT session_id, id, filename, mime_type, size, sha256, storage_key, created_at FROM chat_attachments'
        ).all() as Row[]
        let ok = 0
        let missing = 0
        let corrupt = 0
        for (const row of rows) {
            let buffer: Buffer
            try {
                buffer = await readFile(join(attachmentsRoot(), row.storage_key))
            } catch {
                missing += 1
                console.log(`MISSING  ${row.session_id}  ${row.id}  ${row.filename}`)
                continue
            }
            const sha256 = createHash('sha256').update(buffer).digest('hex')
            if (sha256 !== row.sha256 || buffer.length !== row.size) {
                corrupt += 1
                console.log(`CORRUPT  ${row.session_id}  ${row.id}  ${row.filename}`)
                continue
            }
            ok += 1
        }
        console.log(`verified: ${ok} ok, ${missing} missing, ${corrupt} corrupt (of ${rows.length})`)
        if (missing + corrupt > 0) process.exitCode = 1
    } finally {
        db.close()
    }
}

async function cmdGc(apply: boolean): Promise<void> {
    const db = openDb()
    try {
        const rows = db.prepare('SELECT storage_key FROM chat_attachments').all() as Array<{ storage_key: string }>
        const registered = new Set(rows.map((row) => row.storage_key))
        const orphans = (await listFilesOnDisk()).filter((key) => !registered.has(key))
        if (orphans.length === 0) {
            console.log('no orphan files')
            return
        }
        let bytes = 0
        for (const key of orphans) {
            try {
                bytes += (await stat(join(attachmentsRoot(), key))).size
            } catch {
                // ignore
            }
        }
        console.log(`orphan files: ${orphans.length} (${formatBytes(bytes)})`)
        for (const key of orphans.slice(0, 20)) console.log(`  ${key}`)
        if (orphans.length > 20) console.log(`  ... and ${orphans.length - 20} more`)
        if (!apply) {
            console.log('dry-run: nothing deleted (pass --yes to delete)')
            return
        }
        for (const key of orphans) {
            await rm(join(attachmentsRoot(), key), { force: true })
        }
        console.log(`deleted ${orphans.length} orphan files (freed ${formatBytes(bytes)})`)
    } finally {
        db.close()
    }
}

async function cmdExport(sessionId: string, outDir: string): Promise<void> {
    if (!sessionId.trim()) throw new Error('--session is required')
    if (!outDir.trim()) throw new Error('--out is required')
    const db = openDb()
    try {
        const rows = db.prepare(
            'SELECT session_id, id, filename, mime_type, size, sha256, storage_key, created_at FROM chat_attachments WHERE session_id = ? ORDER BY created_at ASC'
        ).all(sessionId) as Row[]
        if (rows.length === 0) {
            console.log(`no attachments for session ${sessionId}`)
            return
        }
        const target = resolve(outDir)
        await mkdir(target, { recursive: true })
        let copied = 0
        for (const [index, row] of rows.entries()) {
            try {
                const source = join(attachmentsRoot(), row.storage_key)
                const name = `${String(index + 1).padStart(3, '0')}-${row.filename}`
                await copyFile(source, join(target, name))
                copied += 1
            } catch {
                console.log(`MISSING  ${row.id}  ${row.filename}`)
            }
        }
        console.log(`exported ${copied}/${rows.length} files to ${target}`)
    } finally {
        db.close()
    }
}

function usage(): void {
    console.log('usage: bun run hub/scripts/attachments.ts <stats|verify|gc|export> [options]')
    console.log('  gc [--yes]                          delete unreferenced files (dry-run without --yes)')
    console.log('  export --session <id> --out <dir>   copy one session attachments out')
}

const [command, ...rest] = process.argv.slice(2)
const apply = rest.includes('--yes')
const argValue = (name: string): string => {
    const index = rest.indexOf(name)
    return index >= 0 ? (rest[index + 1] ?? '') : ''
}

try {
    if (command === 'stats') await cmdStats()
    else if (command === 'verify') await cmdVerify()
    else if (command === 'gc') await cmdGc(apply)
    else if (command === 'export') await cmdExport(argValue('--session'), argValue('--out'))
    else {
        usage()
        process.exitCode = 1
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
