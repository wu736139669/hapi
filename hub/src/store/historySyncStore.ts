import type { Database } from 'bun:sqlite'
import { CodexHistoryCheckpointSchema, type CodexHistoryState, type CodexHistorySyncRequest } from '@hapi/protocol'

export function bumpHistoryEpoch(db: Database, sid: string): void {
    db.prepare(`INSERT INTO codex_history_epochs (session_id, epoch) VALUES (?, 1)
        ON CONFLICT(session_id) DO UPDATE SET epoch = epoch + 1`).run(sid)
}

/** Checkpoints are derived from durable messages. Keeping both in the Hub
 * makes a restored database authoritative even when the CLI cache survives. */
export class HistorySyncStore {
    constructor(private readonly db: Database) {
        db.exec(`CREATE TABLE IF NOT EXISTS codex_history_sync (
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            thread_id TEXT NOT NULL,
            epoch INTEGER NOT NULL,
            revision INTEGER NOT NULL,
            checkpoint TEXT,
            PRIMARY KEY (session_id, thread_id)
        )`)
        // Display pagination changes when older messages arrive. Only removal
        // or replacement invalidates the native history's durable prefix.
        const existingEpochs = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'codex_history_epochs'").get()
        db.exec(`CREATE TABLE IF NOT EXISTS codex_history_epochs (
            session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
            epoch INTEGER NOT NULL
        )`)
        // Preserve the old invalidation fence during the one-time transition.
        if (!existingEpochs) db.exec(`INSERT OR IGNORE INTO codex_history_epochs (session_id, epoch)
            SELECT DISTINCT progress.session_id, COALESCE(display.epoch, 0)
            FROM codex_history_sync progress
            LEFT JOIN message_epochs display ON display.session_id = progress.session_id`)
    }

    get(sid: string, threadId: string): CodexHistoryState {
        const epoch = (this.db.prepare('SELECT epoch FROM codex_history_epochs WHERE session_id = ?')
            .get(sid) as { epoch: number } | undefined)?.epoch ?? 0
        const row = this.db.prepare('SELECT epoch, revision, checkpoint FROM codex_history_sync WHERE session_id = ? AND thread_id = ?')
            .get(sid, threadId) as { epoch: number; revision: number; checkpoint: string | null } | undefined
        const parsed = row?.checkpoint ? CodexHistoryCheckpointSchema.safeParse(JSON.parse(row.checkpoint)) : null
        return { epoch, revision: row?.revision ?? 0,
            checkpoint: row?.epoch === epoch && parsed?.success ? parsed.data : null }
    }

    commit(sid: string, threadId: string, commit: NonNullable<CodexHistorySyncRequest['commit']>): CodexHistoryState | null {
        return this.db.transaction(() => {
            const prior = this.get(sid, threadId)
            if (prior.epoch !== commit.epoch || prior.revision !== commit.revision) return null
            // Do not trust a client cursor whose corresponding outputs were
            // never saved, even if a transport ACK was misinterpreted.
            const exists = this.db.prepare('SELECT 1 FROM messages WHERE session_id = ? AND local_id = ?')
            if (commit.localIds.some(id => !exists.get(sid, id))) return null
            const revision = prior.revision + 1
            this.db.prepare(`INSERT INTO codex_history_sync (session_id, thread_id, epoch, revision, checkpoint)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id, thread_id) DO UPDATE SET
                epoch = excluded.epoch, revision = excluded.revision, checkpoint = excluded.checkpoint`)
                .run(sid, threadId, prior.epoch, revision, commit.checkpoint ? JSON.stringify(commit.checkpoint) : null)
            return { epoch: prior.epoch, revision, checkpoint: commit.checkpoint }
        })()
    }
}
