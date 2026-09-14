export type TeamStatus = 'active' | 'archived'
export type TeamMemberStatus = 'idle' | 'working' | 'blocked' | 'offline'
export type TeamTaskStatus = 'todo' | 'doing' | 'done' | 'blocked'
export type TeamMessageFromKind = 'human' | 'session' | 'hub'
export type TeamMessageToKind = 'broadcast' | 'mention' | 'dm' | 'task'

export interface TeamSummary {
    id: string
    namespace: string
    name: string
    status: TeamStatus
    leadSessionId: string | null
    config: Record<string, unknown> | null
    createdAt: number
    updatedAt: number
}

export interface TeamMember {
    teamId: string
    sessionId: string
    role: string
    status: TeamMemberStatus
    joinedAt: number
}

export interface TeamTask {
    id: string
    teamId: string
    title: string
    status: TeamTaskStatus
    assigneeSessionId: string | null
    meta: Record<string, unknown> | null
    createdAt: number
    updatedAt: number
}

export interface TeamMessage {
    seq: number
    teamId: string
    fromKind: TeamMessageFromKind
    fromSessionId: string | null
    toKind: TeamMessageToKind
    toSessionId: string | null
    kind: string
    text: string
    meta: Record<string, unknown> | null
    createdAt: number
}

export interface TeamDetail {
    team: TeamSummary
    members: TeamMember[]
    tasks: TeamTask[]
}

export interface TeamMemoryFile {
    path: string
    size: number
    updatedAt: number
}

export interface TeamMemoryFileContent {
    path: string
    content: string
    updatedAt: number
}
