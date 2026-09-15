import { trimIdent } from '@/utils/trimIdent'

/**
 * System-prompt block injected into team member sessions.
 *
 * Gated by HAPI_TEAM_ID (set by the runner when the hub spawns a member), so
 * non-team sessions are byte-identical to before. Flavors without
 * system-prompt injection (ACP) get the same rules via the hub's assignment
 * brief instead.
 */
export function getTeamPromptBlock(toolPrefix: string, env: NodeJS.ProcessEnv = process.env): string | null {
    const teamId = env.HAPI_TEAM_ID?.trim()
    if (!teamId) {
        return null
    }
    const name = env.HAPI_TEAM_NAME?.trim() || teamId.slice(0, 8)
    const role = env.HAPI_TEAM_ROLE?.trim() || 'member'
    return trimIdent(`
        You are a member of HAPI agent team "${name}" (your role: ${role}).
        - Start by calling ${toolPrefix}team_status to pick up your assignment, and ${toolPrefix}team_read to pull team messages (broadcasts are not pushed to you).
        - Report progress, completion, and blockers with ${toolPrefix}team_send (kind=status or task-update). Batch updates; do not chat back and forth.
        - Your normal replies to the human are synced into the team group chat automatically - do not use team_send just to answer the human. Use ${toolPrefix}team_send with to="human" (or kind="decision") only when you genuinely need a human decision; it notifies them out-of-band.
        - Only use ${toolPrefix}spawn_peer when the human or the lead explicitly asks you to.
    `)
}

export function withTeamInstruction(prompt: string, toolPrefix: string, env: NodeJS.ProcessEnv = process.env): string {
    const block = getTeamPromptBlock(toolPrefix, env)
    return block ? `${prompt}\n\n${block}` : prompt
}
