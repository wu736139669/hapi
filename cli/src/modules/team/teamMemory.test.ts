import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureTeamMemory, resolveMainRepoRoot, resolveTeamMemoryDir, teamDirName } from './teamMemory'

const TEAM_ENV = { HAPI_TEAM_ID: 'team-1', HAPI_TEAM_NAME: 'Auth 重构' }

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
            expect(resolveTeamMemoryDir(worktree, TEAM_ENV)).toBe(join(main, '.hapi', 'teams', 'Auth-重构-team1'))
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('names the team directory from the team name + short id', () => {
        expect(teamDirName(TEAM_ENV)).toBe('Auth-重构-team1')
        expect(teamDirName({ HAPI_TEAM_ID: '013fe26a-81fb-4c6c-b3d8-442bf2b67d82' })).toBe('team-013fe26a')
        expect(teamDirName({ HAPI_TEAM_NAME: '增长/搜索 团队' })).toBe('增长-搜索-团队')
        expect(teamDirName({})).toBe('default')
    })

    it('creates charter.md + handoffs only for team sessions', () => {
        const { root, worktree } = makeRepos()
        try {
            expect(ensureTeamMemory({}, worktree)).toBeNull()

            const dir = ensureTeamMemory(TEAM_ENV, worktree)
            expect(dir).toBe(join(root, 'repo', '.hapi', 'teams', 'Auth-重构-team1'))
            const charter = readFileSync(join(dir!, 'charter.md'), 'utf8')
            expect(charter).toContain('Auth 重构')
            expect(existsSync(join(dir!, 'handoffs'))).toBe(true)

            // Idempotent: an existing charter is not overwritten.
            writeFileSync(join(dir!, 'charter.md'), 'custom', 'utf8')
            ensureTeamMemory({ HAPI_TEAM_ID: 'team-1' }, worktree)
            expect(readFileSync(join(dir!, 'charter.md'), 'utf8')).toBe('custom')
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('migrates the legacy shared .hapi/team directory into the team dir', () => {
        const { root, main, worktree } = makeRepos()
        try {
            mkdirSync(join(main, '.hapi', 'team', 'handoffs'), { recursive: true })
            writeFileSync(join(main, '.hapi', 'team', 'charter.md'), 'legacy charter', 'utf8')
            writeFileSync(join(main, '.hapi', 'team', 'handoffs', 'note.md'), 'note', 'utf8')

            const dir = ensureTeamMemory(TEAM_ENV, worktree)
            expect(dir).toBe(join(main, '.hapi', 'teams', 'Auth-重构-team1'))
            expect(existsSync(join(main, '.hapi', 'team'))).toBe(false)
            expect(readFileSync(join(dir!, 'charter.md'), 'utf8')).toBe('legacy charter')
            expect(readFileSync(join(dir!, 'handoffs', 'note.md'), 'utf8')).toBe('note')
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('adds .hapi/ to .gitignore exactly once', () => {
        const { root, main, worktree } = makeRepos()
        try {
            writeFileSync(join(main, '.gitignore'), 'node_modules\n', 'utf8')
            ensureTeamMemory(TEAM_ENV, worktree)
            const first = readFileSync(join(main, '.gitignore'), 'utf8')
            expect(first).toContain('.hapi/')

            ensureTeamMemory(TEAM_ENV, worktree)
            expect(readFileSync(join(main, '.gitignore'), 'utf8')).toBe(first)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })
})
