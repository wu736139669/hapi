import type { AgentFlavor } from '@hapi/protocol'
import type { CopilotAgentMode } from '@hapi/protocol'

export interface SpawnSessionOptions {
    machineId?: string
    directory: string
    sessionId?: string
    // Existing hub session id to reuse (reopen/resume). Distinct from the legacy
    // `sessionId` field above (reserved/unused by spawn): when set, the CLI boots
    // with `--hapi-session-id` so the child reuses the existing hub row (stable
    // id) instead of minting a new one. Set only by the hub reopen/resume path.
    existingSessionId?: string
    resumeSessionId?: string
    approvedNewDirectoryCreation?: boolean
    agent?: AgentFlavor
    model?: string
    effort?: string
    modelReasoningEffort?: string
    yolo?: boolean
    permissionMode?: string
    serviceTier?: string
    collaborationMode?: 'default' | 'plan'
    copilotAgentMode?: CopilotAgentMode
    token?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
    startingMode?: 'remote' | 'pty'
    /** Claude: spawn with --fork-session after --resume. */
    forkSession?: boolean
    /** Runner-internal post-create containment revalidation. Never serialized. */
    validateDirectory?: (path: string) => Promise<boolean>
    /**
     * Agent Team context (hub-set). The runner exports HAPI_TEAM_* env vars so
     * the child CLI can register team MCP tools and identify its role.
     */
    team?: { id: string; name: string; role: string }
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | {
        type: 'error'
        errorMessage: string
        code?: 'agent_unavailable' | 'outside_workspace_roots'
        agent?: AgentFlavor
    }
