import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureTeamMemory, resolveMainRepoRoot, resolveTeamMemoryDir } from './teamMemory'

function makeRepos() {
    const root = mkdtempSync(join(tmpdir(), 'hapi-team-memory-'))
    const main = join(root, 'repo')
    const worktree = join(root, 'wt')
    mkdirSync(join(main, '.git', 'worktrees', 'feat'), { recursive: true })
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'feat')}\n`, 'utf8')
    return { root, main, worktree }
}

describe('teamMemory', () => {
    it('resolves the repo root for a plain checkout and a linked worktree', () => {
        const { root, main, worktree } = makeRepos()
        try {
            expect(resolveMainRepoRoot(main)).toBe(main)
            expect(resolveMainRepoRoot(worktree)).toBe(main)
            expect(resolveTeamMemoryDir(worktree)).toBe(join(main, '.hapi', 'team'))
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('creates charter.md + handoffs only for team sessions', () => {
        const { root, worktree } = makeRepos()
        try {
            expect(ensureTeamMemory({}, worktree)).toBeNull()

            const dir = ensureTeamMemory({ HAPI_TEAM_ID: 'team-1', HAPI_TEAM_NAME: 'Auth 重构' }, worktree)
            expect(dir).toBe(join(root, 'repo', '.hapi', 'team'))
            const charter = readFileSync(join(dir!, 'charter.md'), 'utf8')
            expect(charter).toContain('Auth 重构')

            // Idempotent: an existing charter is not overwritten.
            writeFileSync(join(dir!, 'charter.md'), 'custom', 'utf8')
            ensureTeamMemory({ HAPI_TEAM_ID: 'team-1' }, worktree)
            expect(readFileSync(join(dir!, 'charter.md'), 'utf8')).toBe('custom')
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })
})
