import { createHash, randomBytes } from 'node:crypto'
import { Database } from 'bun:sqlite'

export type TeamInviteKind = 'enroll' | 'recovery'

export type ResolvedAccessToken = {
    namespace: string
    tokenId: string
}

export type CreatedInvite = {
    invite: string
    namespace: string
    expiresAt: number
}

export type ClaimedInvite = {
    accessToken: string
    namespace: string
}

type InviteRow = {
    id: string
    invite_hash: string
    kind: TeamInviteKind
    namespace: string
    expires_at: number
    used_at: number | null
}

function hashSecret(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

function randomSecret(prefix: string): string {
    return `${prefix}_${randomBytes(32).toString('base64url')}`
}

function randomId(prefix: string): string {
    return `${prefix}_${randomBytes(12).toString('hex')}`
}

function validateNamespace(namespace: string): string {
    const trimmed = namespace.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(trimmed) || trimmed === 'default') {
        throw new Error('Namespace must use 2-48 lowercase letters, numbers, _ or - and cannot be default.')
    }
    return trimmed
}

function generatedNamespace(): string {
    return `member-${randomBytes(6).toString('hex')}`
}

export class AccessTokenStore {
    constructor(private readonly db: Database) {}

    resolve(rawToken: string): ResolvedAccessToken | null {
        if (!rawToken) return null
        const tokenHash = hashSecret(rawToken)
        const row = this.db.prepare(
            `SELECT id, namespace
             FROM team_access_tokens
             WHERE token_hash = ? AND revoked_at IS NULL`
        ).get(tokenHash) as { id: string; namespace: string } | undefined
        if (!row) return null

        this.db.prepare(
            'UPDATE team_access_tokens SET last_used_at = ? WHERE id = ?'
        ).run(Date.now(), row.id)
        return { tokenId: row.id, namespace: row.namespace }
    }

    createInvite(input: {
        kind: TeamInviteKind
        namespace?: string
        expiresInHours?: number
        now?: number
    }): CreatedInvite {
        const now = input.now ?? Date.now()
        const expiresInHours = input.expiresInHours ?? 24
        if (!Number.isFinite(expiresInHours) || expiresInHours <= 0 || expiresInHours > 168) {
            throw new Error('Invite expiry must be between 1 and 168 hours.')
        }
        const namespace = input.kind === 'recovery'
            ? validateNamespace(input.namespace ?? '')
            : input.namespace
                ? validateNamespace(input.namespace)
                : generatedNamespace()
        if (input.kind === 'enroll' && input.namespace) {
            const existing = this.db.prepare(
                `SELECT 1 FROM team_access_tokens WHERE namespace = ?
                 UNION ALL SELECT 1 FROM sessions WHERE namespace = ?
                 UNION ALL SELECT 1 FROM machines WHERE namespace = ?
                 LIMIT 1`
            ).get(namespace, namespace, namespace)
            if (existing) {
                throw new Error('Namespace already exists; use a recovery invite instead.')
            }
        }
        if (input.kind === 'recovery') {
            const existing = this.db.prepare(
                `SELECT 1 FROM team_access_tokens WHERE namespace = ?
                 UNION ALL SELECT 1 FROM sessions WHERE namespace = ?
                 UNION ALL SELECT 1 FROM machines WHERE namespace = ?
                 LIMIT 1`
            ).get(namespace, namespace, namespace)
            if (!existing) throw new Error('Namespace was not found.')
        }
        const invite = randomSecret('hapi_invite')
        const expiresAt = now + Math.round(expiresInHours * 60 * 60 * 1000)
        this.db.prepare(
            `INSERT INTO team_invites (id, invite_hash, kind, namespace, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(randomId('invite'), hashSecret(invite), input.kind, namespace, now, expiresAt)
        return { invite, namespace, expiresAt }
    }

    claimInvite(invite: string, now = Date.now()): ClaimedInvite | null {
        if (!invite) return null
        const inviteHash = hashSecret(invite)
        return this.db.transaction(() => {
            const row = this.db.prepare(
                `SELECT id, invite_hash, kind, namespace, expires_at, used_at
                 FROM team_invites
                 WHERE invite_hash = ?`
            ).get(inviteHash) as InviteRow | undefined
            if (!row || row.used_at !== null || row.expires_at <= now) return null

            const update = this.db.prepare(
                'UPDATE team_invites SET used_at = ? WHERE id = ? AND used_at IS NULL'
            ).run(now, row.id)
            if (update.changes !== 1) return null

            this.db.prepare(
                'UPDATE team_access_tokens SET revoked_at = ? WHERE namespace = ? AND revoked_at IS NULL'
            ).run(now, row.namespace)

            const accessToken = randomSecret('hapi_team')
            this.db.prepare(
                `INSERT INTO team_access_tokens (id, token_hash, namespace, created_at)
                 VALUES (?, ?, ?, ?)`
            ).run(randomId('access'), hashSecret(accessToken), row.namespace, now)
            return { accessToken, namespace: row.namespace }
        })()
    }

    revokeNamespace(namespace: string, now = Date.now()): number {
        return this.db.prepare(
            'UPDATE team_access_tokens SET revoked_at = ? WHERE namespace = ? AND revoked_at IS NULL'
        ).run(now, validateNamespace(namespace)).changes
    }
}
