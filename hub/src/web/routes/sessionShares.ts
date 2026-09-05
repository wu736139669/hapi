import { Hono } from "hono";
import { SignJWT } from "jose";
import { z } from "zod";
import type { Store } from "../../store";
import type { SyncEngine } from "../../sync/syncEngine";
import type { WebAppEnv } from "../middleware/auth";
import { requireSession, requireSyncEngine } from "./guards";

const createSchema = z.object({ sessionId: z.string().min(1) });
const exchangeSchema = z.object({
  accessCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

const EXCHANGE_RATE_WINDOW_MS = 60_000;
const EXCHANGE_RATE_LIMIT = 20;
const MAX_EXCHANGE_RATE_BUCKETS = 2_000;
const exchangeRateBuckets = new Map<string, number[]>();

function allowExchange(token: string, now = Date.now()): boolean {
  const windowStart = now - EXCHANGE_RATE_WINDOW_MS;
  for (const [bucketToken, times] of exchangeRateBuckets) {
    const recent = times.filter((time) => time >= windowStart);
    if (recent.length === 0) exchangeRateBuckets.delete(bucketToken);
    else if (recent.length !== times.length) exchangeRateBuckets.set(bucketToken, recent);
  }
  while (exchangeRateBuckets.size >= MAX_EXCHANGE_RATE_BUCKETS && !exchangeRateBuckets.has(token)) {
    const oldestToken = exchangeRateBuckets.keys().next().value as string | undefined;
    if (!oldestToken) break;
    exchangeRateBuckets.delete(oldestToken);
  }
  const recent = (exchangeRateBuckets.get(token) ?? []).filter((time) => time >= windowStart);
  if (recent.length >= EXCHANGE_RATE_LIMIT) {
    exchangeRateBuckets.set(token, recent);
    return false;
  }
  recent.push(now);
  exchangeRateBuckets.set(token, recent);
  return true;
}

export function resetSessionShareExchangeRateLimitForTests(): void {
  exchangeRateBuckets.clear();
}

function sharePayload(share: {
  id: string;
  sessionId: string;
  shareToken: string;
  createdAt: number;
  updatedAt: number;
}) {
  return {
    id: share.id,
    sessionId: share.sessionId,
    shareToken: share.shareToken,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  };
}

export function createSessionShareRoutes(options: {
  store: Store;
  jwtSecret: Uint8Array;
  getSyncEngine: () => SyncEngine | null;
}): Hono<WebAppEnv> {
  const app = new Hono<WebAppEnv>();

  app.post("/session-shares", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

    const engine = requireSyncEngine(c, options.getSyncEngine);
    if (engine instanceof Response) return engine;
    const sessionResult = requireSession(c, engine, parsed.data.sessionId);
    if (sessionResult instanceof Response) return sessionResult;
    if (c.get("role") === "session-guest")
      return c.json({ error: "Guest cannot manage shares" }, 403);

    const created = options.store.sessionShares.createShare(
      sessionResult.sessionId,
      c.get("namespace"),
    );
    c.header("Cache-Control", "no-store");
    return c.json({
      share: sharePayload(created.share),
      accessCode: created.accessCode,
    });
  });

  app.get("/session-shares/session/:sessionId", (c) => {
    if (c.get("role") === "session-guest")
      return c.json({ error: "Guest cannot manage shares" }, 403);
    const engine = requireSyncEngine(c, options.getSyncEngine);
    if (engine instanceof Response) return engine;
    const sessionResult = requireSession(c, engine, c.req.param("sessionId"));
    if (sessionResult instanceof Response) return sessionResult;
    const share = options.store.sessionShares.getActiveBySession(
      sessionResult.sessionId,
      c.get("namespace"),
    );
    return c.json({ share: share ? sharePayload(share) : null });
  });

  app.delete("/session-shares/:id", (c) => {
    if (c.get("role") === "session-guest")
      return c.json({ error: "Guest cannot manage shares" }, 403);
    const revoked = options.store.sessionShares.revokeById(
      c.req.param("id"),
      c.get("namespace"),
    );
    return revoked
      ? c.json({ ok: true })
      : c.json({ error: "Share not found" }, 404);
  });

  app.post("/public/session-shares/:token/exchange", async (c) => {
    const shareTokenParam = c.req.param("token");
    if (!allowExchange(shareTokenParam)) {
      c.header("Retry-After", "60");
      return c.json(
        { error: "Too many verification attempts; try again shortly", code: "rate_limited" },
        429,
      );
    }
    const parsed = exchangeSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        { error: "Invalid access code", code: "invalid_access_code" },
        400,
      );

    const share = options.store.sessionShares.verifyCode(
      shareTokenParam,
      parsed.data.accessCode,
    );
    if (!share) {
      return c.json(
        {
          error: "Invalid access code or revoked share",
          code: "invalid_access_code",
        },
        401,
      );
    }

    exchangeRateBuckets.delete(shareTokenParam);

    const token = await new SignJWT({
      uid: 0,
      ns: share.namespace,
      sid: share.sessionId,
      sht: share.shareToken,
      role: "session-guest",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .sign(options.jwtSecret);

    c.header("Cache-Control", "no-store");
    return c.json({
      token,
      sessionId: share.sessionId,
      share: sharePayload(share),
    });
  });

  return app;
}
