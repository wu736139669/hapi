import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Independent SQLite store for the Agent Team feature (P0).
 *
 * This database is deliberately separate from the hub's main `hapi.db`:
 * - the main store is never touched, so existing sessions/messages cannot be
 *   affected by team schema changes;
 * - the file has its own `user_version` ladder, independent from the main
 *   store's SCHEMA_VERSION;
 * - disabling the feature or deleting this file restores the previous state.
 *
 * Rows still reference session ids (plain TEXT, no cross-database foreign
 * keys). Orphan cleanup is handled at the service layer.
 */

export const TEAM_SCHEMA_VERSION: number = 1

const REQUIRED_TABLES = ['teams', 'team_members', 'team_tasks', 'team_messages', 'team_pending_pings', 'team_agent_tokens', 'team_requirements'] as const

export type TeamStatus = 'active' | 'archived'
export type TeamMemberStatus = 'idle' | 'working' | 'blocked' | 'offline'
export type TeamTaskStatus = 'todo' | 'doing' | 'done' | 'blocked'
export type TeamMessageFromKind = 'human' | 'session' | 'hub'
export type TeamMessageToKind = 'broadcast' | 'mention' | 'dm' | 'task'

export interface TeamRecord {
    id: string
    namespace: string
    name: string
    status: TeamStatus
    leadSessionId: string | null
    config: Record<string, unknown> | null
    createdAt: number
    updatedAt: number
}

export interface TeamMemberRecord {
    teamId: string
    sessionId: string
    role: string
    status: TeamMemberStatus
    joinedAt: number
}

export interface TeamTaskRecord {
    id: string
    teamId: string
    title: string
    status: TeamTaskStatus
    assigneeSessionId: string | null
    meta: Record<string, unknown> | null
    createdAt: number
    updatedAt: number
}

export type TeamRequirementStatus = 'open' | 'doing' | 'done' | 'blocked'

/**
 * A human ask, the parent of the tasks/messages that work on it. Every
 * non-reply human message starts one, so a team's history reads as
 * "requirement -> process -> conclusion" instead of a flat stream.
 */
export interface TeamRequirementRecord {
    id: string
    teamId: string
    title: string
    body: string | null
    status: TeamRequirementStatus
    conclusion: string | null
    createdBySessionId: string | null
    createdAt: number
    updatedAt: number
}

export interface TeamMessageRecord {
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

/**
 * A human ping that a member has not answered yet. Persisted so a hub restart
 * does not lose the "mirror the member's reply into the group chat" bridge.
 */
export interface TeamPendingPingRecord {
    sessionId: string
    teamId: string
    at: number
    sawThinking: boolean
}

/**
 * Team-scoped credential for agents that want to call the hub API directly
 * (instead of, or in addition to, the MCP tools). Grants access only to this
 * team's messages/tasks/status; never to machines or other sessions.
 */
export interface TeamAgentTokenRecord {
    token: string
    teamId: string
    namespace: string
    label: string | null
    createdAt: number
    expiresAt: number
}

export interface CreateTeamInput {
    namespace: string
    name: string
    id?: string
    leadSessionId?: string | null
    config?: Record<string, unknown> | null
}

export interface UpdateTeamInput {
    name?: string
    status?: TeamStatus
    leadSessionId?: string | null
    config?: Record<string, unknown> | null
}

export interface CreateTaskInput {
    teamId: string
    title: string
    id?: string
    status?: TeamTaskStatus
    assigneeSessionId?: string | null
    meta?: Record<string, unknown> | null
}

export interface UpdateTaskInput {
    title?: string
    status?: TeamTaskStatus
    assigneeSessionId?: string | null
    meta?: Record<string, unknown> | null
}

export interface AppendMessageInput {
    teamId: string
    fromKind: TeamMessageFromKind
    fromSessionId?: string | null
    toKind: TeamMessageToKind
    toSessionId?: string | null
    kind?: string
    text: string
    meta?: Record<string, unknown> | null
}

export interface ListMessagesOptions {
    afterSeq?: number
    limit?: number
}

export class TeamStore {
    private readonly db: Database
    private readonly _dbPath: string
    private closed: boolean = false

    get dbPath(): string {
        return this._dbPath
    }

    constructor(dbPath: string) {
        this._dbPath = dbPath
        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            const dir = dirname(dbPath)
            mkdirSync(dir, { recursive: true, mode: 0o700 })
            try {
                chmodSync(dir, 0o700)
            } catch {
            }

            if (!existsSync(dbPath)) {
                try {
                    const fd = openSync(dbPath, 'a', 0o600)
                    closeSync(fd)
                } catch {
                }
            }
        }

        this.db = new Database(dbPath, { create: true, readwrite: true, strict: true })
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA synchronous = NORMAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec('PRAGMA busy_timeout = 5000')
        this.initSchema()

        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
                try {
                    chmodSync(path, 0o600)
                } catch {
                }
            }
        }
    }

    close(): void {
        if (this.closed) return
        this.db.close()
        this.closed = true
        if (process.platform === 'win32') {
            Bun.gc(true)
        }
    }

    // ---------------------------------------------------------------- teams

    createTeam(input: CreateTeamInput): TeamRecord {
        const now = Date.now()
        const record: TeamRecord = {
            id: input.id ?? crypto.randomUUID(),
            namespace: input.namespace,
            name: input.name,
            status: 'active',
            leadSessionId: input.leadSessionId ?? null,
            config: input.config ?? null,
            createdAt: now,
            updatedAt: now
        }
        this.db.prepare(
            `INSERT INTO teams (id, namespace, name, status, lead_session_id, config, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            record.id,
            record.namespace,
            record.name,
            record.status,
            record.leadSessionId,
            toJson(record.config),
            record.createdAt,
            record.updatedAt
        )
        return record
    }

    getTeam(id: string, namespace: string): TeamRecord | null {
        const row = this.db.prepare(
            'SELECT * FROM teams WHERE id = ? AND namespace = ?'
        ).get(id, namespace) as TeamRow | undefined
        return row ? mapTeamRow(row) : null
    }

    listTeams(namespace: string): TeamRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM teams WHERE namespace = ? ORDER BY updated_at DESC'
        ).all(namespace) as TeamRow[]
        return rows.map(mapTeamRow)
    }

    updateTeam(id: string, namespace: string, patch: UpdateTeamInput): TeamRecord | null {
        const current = this.getTeam(id, namespace)
        if (!current) return null

        const next: TeamRecord = {
            ...current,
            name: patch.name ?? current.name,
            status: patch.status ?? current.status,
            leadSessionId: patch.leadSessionId !== undefined ? patch.leadSessionId : current.leadSessionId,
            config: patch.config !== undefined ? patch.config : current.config,
            updatedAt: Date.now()
        }
        this.db.prepare(
            `UPDATE teams SET name = ?, status = ?, lead_session_id = ?, config = ?, updated_at = ?
             WHERE id = ? AND namespace = ?`
        ).run(
            next.name,
            next.status,
            next.leadSessionId,
            toJson(next.config),
            next.updatedAt,
            id,
            namespace
        )
        return next
    }

    deleteTeam(id: string, namespace: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM teams WHERE id = ? AND namespace = ?'
        ).run(id, namespace)
        return result.changes > 0
    }

    // -------------------------------------------------------------- members

    addMember(teamId: string, sessionId: string, role: string, status: TeamMemberStatus = 'idle'): TeamMemberRecord {
        const record: TeamMemberRecord = {
            teamId,
            sessionId,
            role,
            status,
            joinedAt: Date.now()
        }
        this.db.prepare(
            `INSERT INTO team_members (team_id, session_id, role, status, joined_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(team_id, session_id) DO UPDATE SET role = excluded.role, status = excluded.status`
        ).run(record.teamId, record.sessionId, record.role, record.status, record.joinedAt)
        return record
    }

    removeMember(teamId: string, sessionId: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM team_members WHERE team_id = ? AND session_id = ?'
        ).run(teamId, sessionId)
        return result.changes > 0
    }

    listMembers(teamId: string): TeamMemberRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM team_members WHERE team_id = ? ORDER BY joined_at ASC'
        ).all(teamId) as TeamMemberRow[]
        return rows.map(mapMemberRow)
    }

    findTeamBySession(sessionId: string, namespace: string): { team: TeamRecord; member: TeamMemberRecord } | null {
        const row = this.db.prepare(
            `SELECT
                t.id AS team_id, t.namespace AS team_namespace, t.name AS team_name, t.status AS team_status,
                t.lead_session_id AS team_lead_session_id, t.config AS team_config,
                t.created_at AS team_created_at, t.updated_at AS team_updated_at,
                m.team_id AS member_team_id, m.session_id AS member_session_id, m.role AS member_role,
                m.status AS member_status, m.joined_at AS member_joined_at
             FROM team_members m
             JOIN teams t ON t.id = m.team_id
             WHERE m.session_id = ? AND t.namespace = ?
             LIMIT 1`
        ).get(sessionId, namespace) as TeamJoinRow | undefined
        if (!row) return null
        return {
            team: {
                id: row.team_id,
                namespace: row.team_namespace,
                name: row.team_name,
                status: row.team_status === 'archived' ? 'archived' : 'active',
                leadSessionId: row.team_lead_session_id,
                config: parseJsonObject(row.team_config),
                createdAt: row.team_created_at,
                updatedAt: row.team_updated_at
            },
            member: {
                teamId: row.member_team_id,
                sessionId: row.member_session_id,
                role: row.member_role,
                status: row.member_status === 'working' || row.member_status === 'blocked' || row.member_status === 'offline'
                    ? row.member_status
                    : 'idle',
                joinedAt: row.member_joined_at
            }
        }
    }

    updateMemberStatus(teamId: string, sessionId: string, status: TeamMemberStatus): boolean {
        const result = this.db.prepare(
            'UPDATE team_members SET status = ? WHERE team_id = ? AND session_id = ?'
        ).run(status, teamId, sessionId)
        return result.changes > 0
    }

    // ---------------------------------------------------------------- tasks

    createTask(input: CreateTaskInput): TeamTaskRecord {
        const now = Date.now()
        const record: TeamTaskRecord = {
            id: input.id ?? crypto.randomUUID(),
            teamId: input.teamId,
            title: input.title,
            status: input.status ?? 'todo',
            assigneeSessionId: input.assigneeSessionId ?? null,
            meta: input.meta ?? null,
            createdAt: now,
            updatedAt: now
        }
        this.db.prepare(
            `INSERT INTO team_tasks (id, team_id, title, status, assignee_session_id, meta, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            record.id,
            record.teamId,
            record.title,
            record.status,
            record.assigneeSessionId,
            toJson(record.meta),
            record.createdAt,
            record.updatedAt
        )
        return record
    }

    getTask(id: string): TeamTaskRecord | null {
        const row = this.db.prepare('SELECT * FROM team_tasks WHERE id = ?').get(id) as TeamTaskRow | undefined
        return row ? mapTaskRow(row) : null
    }

    listTasks(teamId: string): TeamTaskRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM team_tasks WHERE team_id = ? ORDER BY created_at ASC'
        ).all(teamId) as TeamTaskRow[]
        return rows.map(mapTaskRow)
    }

    updateTask(id: string, patch: UpdateTaskInput): TeamTaskRecord | null {
        const current = this.getTask(id)
        if (!current) return null

        const next: TeamTaskRecord = {
            ...current,
            title: patch.title ?? current.title,
            status: patch.status ?? current.status,
            assigneeSessionId: patch.assigneeSessionId !== undefined ? patch.assigneeSessionId : current.assigneeSessionId,
            meta: patch.meta !== undefined ? patch.meta : current.meta,
            updatedAt: Date.now()
        }
        this.db.prepare(
            `UPDATE team_tasks SET title = ?, status = ?, assignee_session_id = ?, meta = ?, updated_at = ?
             WHERE id = ?`
        ).run(
            next.title,
            next.status,
            next.assigneeSessionId,
            toJson(next.meta),
            next.updatedAt,
            id
        )
        return next
    }

    // ------------------------------------------------------------- messages

    appendMessage(input: AppendMessageInput): TeamMessageRecord {
        const now = Date.now()
        const result = this.db.prepare(
            `INSERT INTO team_messages
                (team_id, from_kind, from_session_id, to_kind, to_session_id, kind, text, meta, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            input.teamId,
            input.fromKind,
            input.fromSessionId ?? null,
            input.toKind,
            input.toSessionId ?? null,
            input.kind ?? 'chat',
            input.text,
            toJson(input.meta ?? null),
            now
        )
        return {
            seq: Number(result.lastInsertRowid),
            teamId: input.teamId,
            fromKind: input.fromKind,
            fromSessionId: input.fromSessionId ?? null,
            toKind: input.toKind,
            toSessionId: input.toSessionId ?? null,
            kind: input.kind ?? 'chat',
            text: input.text,
            meta: input.meta ?? null,
            createdAt: now
        }
    }

    listMessages(teamId: string, options: ListMessagesOptions = {}): TeamMessageRecord[] {
        const afterSeq = options.afterSeq ?? 0
        const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000)
        const rows = this.db.prepare(
            `SELECT * FROM team_messages WHERE team_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`
        ).all(teamId, afterSeq, limit) as TeamMessageRow[]
        return rows.map(mapMessageRow)
    }

    getMessage(teamId: string, seq: number): TeamMessageRecord | null {
        const row = this.db.prepare(
            'SELECT * FROM team_messages WHERE team_id = ? AND seq = ?'
        ).get(teamId, seq) as TeamMessageRow | undefined
        return row ? mapMessageRow(row) : null
    }

    /** Merge `patch` into a message's meta (used to track human replies/dismissals). */
    updateMessageMeta(teamId: string, seq: number, patch: Record<string, unknown>): TeamMessageRecord | null {
        const current = this.getMessage(teamId, seq)
        if (!current) return null
        const meta = { ...(current.meta ?? {}), ...patch }
        this.db.prepare(
            'UPDATE team_messages SET meta = ? WHERE team_id = ? AND seq = ?'
        ).run(toJson(meta), teamId, seq)
        return { ...current, meta }
    }

    // --------------------------------------------------------- pending pings

    setPendingPing(record: TeamPendingPingRecord): void {
        this.db.prepare(
            `INSERT INTO team_pending_pings (session_id, team_id, at, saw_thinking)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET
                 team_id = excluded.team_id,
                 at = excluded.at,
                 saw_thinking = excluded.saw_thinking`
        ).run(record.sessionId, record.teamId, record.at, record.sawThinking ? 1 : 0)
    }

    markPendingPingThinking(sessionId: string): void {
        this.db.prepare(
            'UPDATE team_pending_pings SET saw_thinking = 1 WHERE session_id = ?'
        ).run(sessionId)
    }

    deletePendingPing(sessionId: string): void {
        this.db.prepare('DELETE FROM team_pending_pings WHERE session_id = ?').run(sessionId)
    }

    listPendingPings(): TeamPendingPingRecord[] {
        const rows = this.db.prepare(
            'SELECT session_id, team_id, at, saw_thinking FROM team_pending_pings'
        ).all() as Array<{ session_id: string; team_id: string; at: number; saw_thinking: number }>
        return rows.map((row) => ({
            sessionId: row.session_id,
            teamId: row.team_id,
            at: row.at,
            sawThinking: row.saw_thinking === 1
        }))
    }

    // ---------------------------------------------------- team agent tokens

    insertAgentToken(record: TeamAgentTokenRecord): void {
        this.db.prepare(
            `INSERT OR REPLACE INTO team_agent_tokens (token, team_id, namespace, label, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(record.token, record.teamId, record.namespace, record.label, record.createdAt, record.expiresAt)
    }

    findAgentToken(token: string): TeamAgentTokenRecord | null {
        const row = this.db.prepare(
            'SELECT token, team_id, namespace, label, created_at, expires_at FROM team_agent_tokens WHERE token = ?'
        ).get(token) as TeamAgentTokenRow | undefined
        return row ? mapAgentTokenRow(row) : null
    }

    latestAgentToken(teamId: string, now: number): TeamAgentTokenRecord | null {
        const row = this.db.prepare(
            `SELECT token, team_id, namespace, label, created_at, expires_at FROM team_agent_tokens
             WHERE team_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`
        ).get(teamId, now) as TeamAgentTokenRow | undefined
        return row ? mapAgentTokenRow(row) : null
    }

    deleteExpiredAgentTokens(now: number): number {
        const result = this.db.prepare('DELETE FROM team_agent_tokens WHERE expires_at <= ?').run(now)
        return result.changes
    }

    // -------------------------------------------------------- requirements

    createRequirement(input: {
        teamId: string
        title: string
        body?: string | null
        createdBySessionId?: string | null
        id?: string
    }): TeamRequirementRecord {
        const now = Date.now()
        const record: TeamRequirementRecord = {
            id: input.id ?? crypto.randomUUID(),
            teamId: input.teamId,
            title: input.title,
            body: input.body ?? null,
            status: 'open',
            conclusion: null,
            createdBySessionId: input.createdBySessionId ?? null,
            createdAt: now,
            updatedAt: now
        }
        this.db.prepare(
            `INSERT INTO team_requirements (id, team_id, title, body, status, conclusion, created_by_session_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            record.id,
            record.teamId,
            record.title,
            record.body,
            record.status,
            record.conclusion,
            record.createdBySessionId,
            record.createdAt,
            record.updatedAt
        )
        return record
    }

    getRequirement(id: string): TeamRequirementRecord | null {
        const row = this.db.prepare(
            'SELECT id, team_id, title, body, status, conclusion, created_by_session_id, created_at, updated_at FROM team_requirements WHERE id = ?'
        ).get(id) as TeamRequirementRow | undefined
        return row ? mapRequirementRow(row) : null
    }

    listRequirements(teamId: string): TeamRequirementRecord[] {
        const rows = this.db.prepare(
            'SELECT id, team_id, title, body, status, conclusion, created_by_session_id, created_at, updated_at FROM team_requirements WHERE team_id = ? ORDER BY created_at ASC'
        ).all(teamId) as TeamRequirementRow[]
        return rows.map(mapRequirementRow)
    }

    updateRequirement(
        id: string,
        patch: { title?: string; status?: TeamRequirementStatus; conclusion?: string | null }
    ): TeamRequirementRecord | null {
        const current = this.getRequirement(id)
        if (!current) return null
        const next: TeamRequirementRecord = {
            ...current,
            title: patch.title ?? current.title,
            status: patch.status ?? current.status,
            conclusion: patch.conclusion !== undefined ? patch.conclusion : current.conclusion,
            updatedAt: Date.now()
        }
        this.db.prepare(
            'UPDATE team_requirements SET title = ?, status = ?, conclusion = ?, updated_at = ? WHERE id = ?'
        ).run(next.title, next.status, next.conclusion, next.updatedAt, id)
        return next
    }

    // -------------------------------------------------------------- schema

    private initSchema(): void {
        const currentVersion = this.getUserVersion()

        if (currentVersion === 0) {
            this.createSchemaV1()
            this.setUserVersion(1)
        } else if (currentVersion > TEAM_SCHEMA_VERSION) {
            throw new Error(
                `teams.db schema version ${currentVersion} is newer than supported ${TEAM_SCHEMA_VERSION}. ` +
                'Upgrade the hub or restore an older teams.db.'
            )
        }

        // Additive tables are ensured without a version bump so the previous
        // hub binary can still open the file (rollback safety).
        this.ensureAdditiveTables()

        // Future step migrations (V1 -> V2 -> ...) run here, following the main
        // store's ladder pattern. None exist yet.
        this.assertRequiredTablesPresent()
    }

    private ensureAdditiveTables(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS team_pending_pings (
                session_id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                at INTEGER NOT NULL,
                saw_thinking INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS team_agent_tokens (
                token TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                namespace TEXT NOT NULL,
                label TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_team_agent_tokens_team ON team_agent_tokens(team_id, expires_at);

            CREATE TABLE IF NOT EXISTS team_requirements (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                conclusion TEXT,
                created_by_session_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_team_requirements_team ON team_requirements(team_id, created_at);
        `)
    }

    private createSchemaV1(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
                lead_session_id TEXT,
                config TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_teams_namespace ON teams(namespace, updated_at);

            CREATE TABLE IF NOT EXISTS team_members (
                team_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                joined_at INTEGER NOT NULL,
                PRIMARY KEY (team_id, session_id),
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_team_members_session ON team_members(session_id);

            CREATE TABLE IF NOT EXISTS team_tasks (
                id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'todo',
                assignee_session_id TEXT,
                meta TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_team_tasks_team ON team_tasks(team_id, status);

            CREATE TABLE IF NOT EXISTS team_messages (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id TEXT NOT NULL,
                from_kind TEXT NOT NULL CHECK (from_kind IN ('human', 'session', 'hub')),
                from_session_id TEXT,
                to_kind TEXT NOT NULL CHECK (to_kind IN ('broadcast', 'mention', 'dm', 'task')),
                to_session_id TEXT,
                kind TEXT NOT NULL DEFAULT 'chat',
                text TEXT NOT NULL,
                meta TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_team_messages_team_seq ON team_messages(team_id, seq);

            CREATE TABLE IF NOT EXISTS team_pending_pings (
                session_id TEXT PRIMARY KEY,
                team_id TEXT NOT NULL,
                at INTEGER NOT NULL,
                saw_thinking INTEGER NOT NULL DEFAULT 0
            );
        `)
    }

    private assertRequiredTablesPresent(): void {
        const rows = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).all() as Array<{ name: string }>
        const present = new Set(rows.map(row => row.name))
        for (const table of REQUIRED_TABLES) {
            if (!present.has(table)) {
                throw new Error(`teams.db is missing required table: ${table}`)
            }
        }
    }

    private getUserVersion(): number {
        const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
        return row?.user_version ?? 0
    }

    private setUserVersion(version: number): void {
        this.db.exec(`PRAGMA user_version = ${version}`)
    }
}

// ---------------------------------------------------------------- row types

interface TeamRow {
    id: string
    namespace: string
    name: string
    status: string
    lead_session_id: string | null
    config: string | null
    created_at: number
    updated_at: number
}

interface TeamMemberRow {
    team_id: string
    session_id: string
    role: string
    status: string
    joined_at: number
}

interface TeamTaskRow {
    id: string
    team_id: string
    title: string
    status: string
    assignee_session_id: string | null
    meta: string | null
    created_at: number
    updated_at: number
}

interface TeamMessageRow {
    seq: number
    team_id: string
    from_kind: string
    from_session_id: string | null
    to_kind: string
    to_session_id: string | null
    kind: string
    text: string
    meta: string | null
    created_at: number
}

interface TeamAgentTokenRow {
    token: string
    team_id: string
    namespace: string
    label: string | null
    created_at: number
    expires_at: number
}

interface TeamRequirementRow {
    id: string
    team_id: string
    title: string
    body: string | null
    status: string
    conclusion: string | null
    created_by_session_id: string | null
    created_at: number
    updated_at: number
}

interface TeamJoinRow {
    team_id: string
    team_namespace: string
    team_name: string
    team_status: string
    team_lead_session_id: string | null
    team_config: string | null
    team_created_at: number
    team_updated_at: number
    member_team_id: string
    member_session_id: string
    member_role: string
    member_status: string
    member_joined_at: number
}

function mapAgentTokenRow(row: TeamAgentTokenRow): TeamAgentTokenRecord {
    return {
        token: row.token,
        teamId: row.team_id,
        namespace: row.namespace,
        label: row.label,
        createdAt: row.created_at,
        expiresAt: row.expires_at
    }
}

function mapRequirementRow(row: TeamRequirementRow): TeamRequirementRecord {
    const status: TeamRequirementStatus = row.status === 'doing' || row.status === 'done' || row.status === 'blocked'
        ? row.status
        : 'open'
    return {
        id: row.id,
        teamId: row.team_id,
        title: row.title,
        body: row.body,
        status,
        conclusion: row.conclusion,
        createdBySessionId: row.created_by_session_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function mapTeamRow(row: TeamRow): TeamRecord {
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        status: row.status === 'archived' ? 'archived' : 'active',
        leadSessionId: row.lead_session_id,
        config: parseJsonObject(row.config),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function mapMemberRow(row: TeamMemberRow): TeamMemberRecord {
    return {
        teamId: row.team_id,
        sessionId: row.session_id,
        role: row.role,
        status: row.status === 'working' || row.status === 'blocked' || row.status === 'offline' ? row.status : 'idle',
        joinedAt: row.joined_at
    }
}

function mapTaskRow(row: TeamTaskRow): TeamTaskRecord {
    return {
        id: row.id,
        teamId: row.team_id,
        title: row.title,
        status: row.status === 'doing' || row.status === 'done' || row.status === 'blocked' ? row.status : 'todo',
        assigneeSessionId: row.assignee_session_id,
        meta: parseJsonObject(row.meta),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function mapMessageRow(row: TeamMessageRow): TeamMessageRecord {
    return {
        seq: row.seq,
        teamId: row.team_id,
        fromKind: row.from_kind === 'human' || row.from_kind === 'hub' ? row.from_kind : 'session',
        fromSessionId: row.from_session_id,
        toKind: row.to_kind === 'mention' || row.to_kind === 'dm' || row.to_kind === 'task' ? row.to_kind : 'broadcast',
        toSessionId: row.to_session_id,
        kind: row.kind,
        text: row.text,
        meta: parseJsonObject(row.meta),
        createdAt: row.created_at
    }
}

function toJson(value: Record<string, unknown> | null): string | null {
    return value === null ? null : JSON.stringify(value)
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
    if (value === null) return null
    try {
        const parsed: unknown = JSON.parse(value)
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null
    } catch {
        return null
    }
}
