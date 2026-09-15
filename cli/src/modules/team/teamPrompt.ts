import { trimIdent } from '@/utils/trimIdent'
import { ensureTeamMemory } from './teamMemory'

/**
 * System-prompt block injected into team member sessions.
 *
 * Gated by HAPI_TEAM_ID (set by the runner when the hub spawns a member), so
 * non-team sessions are byte-identical to before. Flavors without
 * system-prompt injection (ACP) get the same rules via the hub's assignment
 * brief instead.
 */
export function getTeamPromptBlock(toolPrefix: string, env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string | null {
    const teamId = env.HAPI_TEAM_ID?.trim()
    if (!teamId) {
        return null
    }
    const name = env.HAPI_TEAM_NAME?.trim() || teamId.slice(0, 8)
    const role = env.HAPI_TEAM_ROLE?.trim() || 'member'
    // Memory lives with the code: <repo>/.hapi/teams/<team>/ (worktrees share the main repo).
    const memoryDir = ensureTeamMemory(env, cwd)
    const memoryLine = memoryDir
        ? `- Team memory lives with the code: ${memoryDir}/ (charter.md = team charter, handoffs/ = handoff notes). Read/write it with your normal file tools.`
        : null
    return trimIdent(`
        You are a member of HAPI agent team "${name}" (your role: ${role}).
        - Start by calling ${toolPrefix}team_status to pick up your assignment, and ${toolPrefix}team_read to pull team messages (broadcasts are not pushed to you).
        - Report progress, completion, and blockers with ${toolPrefix}team_send (kind=status or task-update). Batch updates; do not chat back and forth.
        - Track your work with ${toolPrefix}team_task (list/update): set a task to doing when you start, blocked when stuck, and done when finished. A done task requires a deliverable (evidence: branch/commit/files/test result), and doing/done requires its dependencies to be done first.
        - Replies to a message the human just sent you are synced into the team group chat automatically. If your turn was triggered by anything else (a teammate message, a task, a timer) and it ends with something the human must see or decide, you MUST send it explicitly with ${toolPrefix}team_send (to="human", or kind="decision" when you need an answer) - such content is NOT synced automatically.
        - Spawned members inherit your tool/model/thinking level/permission by default; only pass overrides to ${toolPrefix}spawn_peer when the human explicitly asks for a different setup.
        - If you need the hub API directly (scripting), use the team-scoped token in $HAPI_TEAM_TOKEN against $HAPI_API_URL. It only reaches this team's messages/tasks/status. NEVER read or use ~/.hapi/settings.json credentials.
        - Only use ${toolPrefix}spawn_peer when the human or the lead explicitly asks you to.
        ${memoryLine ?? ''}
    `)
}

export function withTeamInstruction(prompt: string, toolPrefix: string, env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
    const block = getTeamPromptBlock(toolPrefix, env, cwd)
    return block ? `${prompt}\n\n${block}` : prompt
}
