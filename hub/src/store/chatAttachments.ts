import type { Database } from 'bun:sqlite'

export type StoredChatAttachment = {
    sessionId: string
    id: string
    filename: string
    mimeType: string
    size: number
    sha256: string
    storageKey: string
    createdAt: number
}

type ChatAttachmentRow = {
    session_id: string
    id: string
    filename: string
    mime_type: string
    size: number
    sha256: string
    storage_key: string
    created_at: number
}

function toStoredChatAttachment(row: ChatAttachmentRow): StoredChatAttachment {
    return {
        sessionId: row.session_id,
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type,
        size: row.size,
        sha256: row.sha256,
        storageKey: row.storage_key,
        createdAt: row.created_at
    }
}

const COLUMNS = 'session_id, id, filename, mime_type, size, sha256, storage_key, created_at'

/** Durable hub copies of chat image attachments (schema v27). */
export class ChatAttachmentsStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    upsert(attachment: StoredChatAttachment): void {
        this.db.prepare(`
            INSERT INTO chat_attachments (${COLUMNS})
            VALUES (@session_id, @id, @filename, @mime_type, @size, @sha256, @storage_key, @created_at)
            ON CONFLICT(session_id, id) DO UPDATE SET
                filename = excluded.filename,
                mime_type = excluded.mime_type,
                size = excluded.size,
                sha256 = excluded.sha256,
                storage_key = excluded.storage_key
        `).run({
            session_id: attachment.sessionId,
            id: attachment.id,
            filename: attachment.filename,
            mime_type: attachment.mimeType,
            size: attachment.size,
            sha256: attachment.sha256,
            storage_key: attachment.storageKey,
            created_at: attachment.createdAt
        })
    }

    get(sessionId: string, id: string): StoredChatAttachment | null {
        const row = this.db.prepare(
            `SELECT ${COLUMNS} FROM chat_attachments WHERE session_id = ? AND id = ?`
        ).get(sessionId, id) as ChatAttachmentRow | undefined
        return row ? toStoredChatAttachment(row) : null
    }

    listBySession(sessionId: string): StoredChatAttachment[] {
        const rows = this.db.prepare(
            `SELECT ${COLUMNS} FROM chat_attachments WHERE session_id = ? ORDER BY created_at ASC`
        ).all(sessionId) as ChatAttachmentRow[]
        return rows.map(toStoredChatAttachment)
    }

    listAll(): StoredChatAttachment[] {
        const rows = this.db.prepare(
            `SELECT ${COLUMNS} FROM chat_attachments ORDER BY session_id, created_at ASC`
        ).all() as ChatAttachmentRow[]
        return rows.map(toStoredChatAttachment)
    }

    delete(sessionId: string, id: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM chat_attachments WHERE session_id = ? AND id = ?'
        ).run(sessionId, id)
        return result.changes > 0
    }

    sumBytes(): number {
        const row = this.db.prepare(
            'SELECT COALESCE(SUM(size), 0) AS total FROM chat_attachments'
        ).get() as { total: number }
        return row.total
    }
}
