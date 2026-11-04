#!/usr/bin/env node

import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'

const dshBin = process.env.DSH_BIN?.trim()
const tokenFile = process.env.DSH_TOKEN_FILE?.trim()
if (!dshBin || !tokenFile) {
    console.error('dsh web wrapper requires DSH_BIN and DSH_TOKEN_FILE')
    process.exit(64)
}

mkdirSync(dirname(tokenFile), { recursive: true, mode: 0o700 })
try { unlinkSync(tokenFile) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
}

const child = spawn(process.env.DSH_NODE?.trim() || process.execPath, [dshBin, ...process.argv.slice(2)], {
    env: process.env,
    stdio: ['inherit', 'pipe', 'inherit']
})

let pending = ''
let tokenSaved = false
const consume = (chunk) => {
    const text = String(chunk)
    process.stdout.write(text)
    pending += text
    const lines = pending.split(/\r?\n/u)
    pending = lines.pop() ?? ''
    for (const line of lines) {
        const match = /dsh web:\s*https?:\/\/[^\s?]+(?:\?[^\s]*)?token=([A-Za-z0-9_-]+)/u.exec(line)
        if (!match || tokenSaved) continue
        const temporary = `${tokenFile}.tmp-${process.pid}`
        writeFileSync(temporary, `${match[1]}\n`, { mode: 0o600 })
        chmodSync(temporary, 0o600)
        renameSync(temporary, tokenFile)
        tokenSaved = true
    }
}
child.stdout.on('data', consume)
child.on('error', (error) => {
    console.error(`dsh web wrapper failed to start: ${error.message}`)
})
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => child.kill(signal))
}
child.on('exit', (code, signal) => {
    if (pending) consume('')
    process.exit(signal ? 1 : (code ?? 1))
})
