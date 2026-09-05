import type { Database } from "bun:sqlite";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { constantTimeEquals } from "../utils/crypto";

export type StoredSessionShare = {
  id: string;
  sessionId: string;
  namespace: string;
  shareToken: string;
  accessCodeHash: string;
  status: "active" | "revoked";
  createdAt: number;
  updatedAt: number;
};

type SessionShareRow = {
  id: string;
  session_id: string;
  namespace: string;
  share_token: string;
  access_code_hash: string;
  status: "active" | "revoked";
  created_at: number;
  updated_at: number;
};

function mapRow(row: SessionShareRow): StoredSessionShare {
  return {
    id: row.id,
    sessionId: row.session_id,
    namespace: row.namespace,
    shareToken: row.share_token,
    accessCodeHash: row.access_code_hash,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function hashSessionShareCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

export class SessionShareStore {
  constructor(private readonly db: Database) {}

  createShare(
    sessionId: string,
    namespace: string,
  ): { share: StoredSessionShare; accessCode: string } {
    return this.db.transaction(() => {
      const now = Date.now();
      this.db
        .prepare(
          `
                UPDATE session_shares SET status = 'revoked', updated_at = ?
                WHERE session_id = ? AND namespace = ? AND status = 'active'
            `,
        )
        .run(now, sessionId, namespace);

      const shareToken = randomBytes(32).toString("base64url");
      const accessCode = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const id = randomUUID();
      this.db
        .prepare(
          `
                INSERT INTO session_shares (
                    id, session_id, namespace, share_token, access_code_hash,
                    status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
            `,
        )
        .run(
          id,
          sessionId,
          namespace,
          shareToken,
          hashSessionShareCode(accessCode),
          now,
          now,
        );
      return { share: this.getById(id, namespace)!, accessCode };
    })();
  }

  getById(id: string, namespace: string): StoredSessionShare | null {
    const row = this.db
      .prepare("SELECT * FROM session_shares WHERE id = ? AND namespace = ?")
      .get(id, namespace) as SessionShareRow | undefined;
    return row ? mapRow(row) : null;
  }

  getActiveBySession(
    sessionId: string,
    namespace: string,
  ): StoredSessionShare | null {
    const row = this.db
      .prepare(
        "SELECT * FROM session_shares WHERE session_id = ? AND namespace = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      )
      .get(sessionId, namespace) as SessionShareRow | undefined;
    return row ? mapRow(row) : null;
  }

  getActiveByToken(token: string): StoredSessionShare | null {
    const row = this.db
      .prepare(
        "SELECT * FROM session_shares WHERE share_token = ? AND status = 'active'",
      )
      .get(token) as SessionShareRow | undefined;
    return row ? mapRow(row) : null;
  }

  verifyCode(token: string, code: string): StoredSessionShare | null {
    const share = this.getActiveByToken(token);
    if (
      !share ||
      !constantTimeEquals(hashSessionShareCode(code), share.accessCodeHash)
    )
      return null;
    return share;
  }

  revokeById(id: string, namespace: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE session_shares SET status = 'revoked', updated_at = ? WHERE id = ? AND namespace = ? AND status = 'active'",
      )
      .run(Date.now(), id, namespace);
    return result.changes > 0;
  }
}
