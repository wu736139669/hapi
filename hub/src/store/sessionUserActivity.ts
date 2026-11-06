import type { Database } from 'bun:sqlite'
import { isObject, unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol'
import { extractUserPlainText } from '@hapi/protocol/messages'
import { decodeMessageContent } from './contentCodec'
import { prepareCached } from './statementCache'

export function isUserInputMessage(content: unknown): boolean {
    const message = unwrapRoleWrappedRecordEnvelope(content)
    return message?.role === 'user'
        && !(isObject(message.meta) && message.meta.isTranscriptEcho === true)
}

const LAST_USER_PREVIEW_MAX_SOURCE_CHARS = 300

/** Display-only preview of the human prompt; never used for matching. */
function previewText(content: unknown): string {
    const message = unwrapRoleWrappedRecordEnvelope(content)
    if (!message) return ''
    return extractUserPlainText(message.content, LAST_USER_PREVIEW_MAX_SOURCE_CHARS)?.trim() ?? ''
}

/** Called in the message insertion transaction, never on delivery ACKs/replays.
 * Agent envelopes (including Claude tool results with an inner user role) are
 * not user input. Keep the original timestamp when importing/copying history. */
export function recordUserMessage(db: Database, sessionId: string, content: unknown, createdAt: number): void {
    if (!isUserInputMessage(content)) return
    prepareCached(db, `
        UPDATE sessions SET last_user_message_at = ?
        WHERE id = ? AND (last_user_message_at IS NULL OR last_user_message_at < ?)
    `).run(createdAt, sessionId, createdAt)
    prepareCached(db, `
        INSERT INTO session_last_user_messages (session_id, text, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            text = excluded.text,
            created_at = excluded.created_at
        WHERE excluded.created_at >= session_last_user_messages.created_at
    `).run(sessionId, previewText(content), createdAt)
}

/** One-time/on-start fill for sessions that predate the preview table. */
export function backfillLastUserMessagePreviews(db: Database): void {
    const missing = db.prepare(`
        SELECT s.id
        FROM sessions s
        LEFT JOIN session_last_user_messages p ON p.session_id = s.id
        WHERE p.session_id IS NULL
    `).all() as Array<{ id: string }>
    if (missing.length === 0) return
    const insert = db.prepare(`
        INSERT OR IGNORE INTO session_last_user_messages (session_id, text, created_at)
        VALUES (?, ?, ?)
    `)
    const messages = db.prepare(`
        SELECT content, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY COALESCE(invoked_at, created_at) DESC, seq DESC
        LIMIT 30
    `)
    for (const { id } of missing) {
        let preview = ''
        let at = 0
        for (const row of messages.all(id) as Array<{ content: string | Uint8Array; created_at: number }>) {
            const content = decodeMessageContent(row.content)
            if (isUserInputMessage(content)) {
                preview = previewText(content)
                at = row.created_at
                break
            }
        }
        insert.run(id, preview, at)
    }
}

/** One-time migration. Message content can be plaintext JSON or compressed;
 * iterate rather than materializing the entire conversation history. */
export function backfillLastUserMessageAt(db: Database): void {
    const latest = new Map<string, number>()
    for (const row of db.prepare('SELECT session_id, content, created_at FROM messages').iterate() as Iterable<{
        session_id: string; content: string | Uint8Array; created_at: number
    }>) {
        if (row.created_at <= (latest.get(row.session_id) ?? -Infinity)) continue
        if (isUserInputMessage(decodeMessageContent(row.content))) {
            latest.set(row.session_id, row.created_at)
        }
    }
    const update = db.prepare('UPDATE sessions SET last_user_message_at = ? WHERE id = ?')
    for (const [id, at] of latest) update.run(at, id)
}
