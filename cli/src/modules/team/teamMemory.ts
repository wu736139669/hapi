import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Team memory lives with the code, like CLAUDE.md / project docs:
 * `<main repo root>/.hapi/team/` on the machine where the agent runs.
 *
 * Worktrees point at the main repository so every member's worktree shares one
 * memory directory (a linked worktree's `.git` is a file: `gitdir: <main>/.git/worktrees/<name>`).
 */
export function resolveMainRepoRoot(cwd: string = process.cwd()): string {
    const dotGit = join(cwd, '.git')
    let isDirectory = false
    try {
        isDirectory = statSync(dotGit).isDirectory()
    } catch {
        isDirectory = false
    }
    if (isDirectory) {
        return cwd
    }
    try {
        const content = readFileSync(dotGit, 'utf8')
        const match = content.match(/^gitdir:\s*(.+)\s*$/m)
        if (match?.[1]) {
            // <main>/.git/worktrees/<name> -> <main>
            return resolve(match[1].trim(), '..', '..', '..')
        }
    } catch {
        // not a worktree
    }
    return cwd
}

export function resolveTeamMemoryDir(cwd: string = process.cwd()): string {
    return join(resolveMainRepoRoot(cwd), '.hapi', 'team')
}

/**
 * Ensure the team memory dir + charter.md exist for a team member session.
 * Returns the directory, or null when the session is not in a team.
 */
export function ensureTeamMemory(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string | null {
    const teamId = env.HAPI_TEAM_ID?.trim()
    if (!teamId) {
        return null
    }
    const dir = resolveTeamMemoryDir(cwd)
    try {
        mkdirSync(join(dir, 'handoffs'), { recursive: true })
        const charter = join(dir, 'charter.md')
        if (!existsSync(charter)) {
            const name = env.HAPI_TEAM_NAME?.trim() || teamId.slice(0, 8)
            writeFileSync(charter, charterTemplate(name), 'utf8')
        }
    } catch {
        // Best effort: the agent can still create the files itself.
    }
    return dir
}

function charterTemplate(teamName: string): string {
    return [
        `# ${teamName} — 团队规约`,
        '',
        '> 团队记忆与代码放在一起，成员用普通文件工具读写；提交与否由团队决定。',
        '',
        '## 目标',
        '（lead 或人类补充这个团队要达成什么）',
        '',
        '## 协作规则',
        '- 广播消息不会主动推送：开工前用 team_read 拉取，完成后用 team_send 汇报。',
        '- 需要人类决策时用 team_send 的 to="human" 或 kind="decision"。',
        '- 交接产物写到 handoffs/ 目录，文件名用任务 id 或简短主题。',
        '',
        '## 决策记录',
        '（重要取舍追加到这里，说明日期、背景、结论）',
        ''
    ].join('\n')
}
