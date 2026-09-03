import { describe, expect, it } from "bun:test";
import { SignJWT } from "jose";
import { Hono } from "hono";
import { Store } from "../../store";
import type { SyncEngine } from "../../sync/syncEngine";
import { createAuthMiddleware } from "../middleware/auth";
import type { WebAppEnv } from "../middleware/auth";
import {
  createSessionShareRoutes,
  resetSessionShareExchangeRateLimitForTests,
} from "./sessionShares";
import { createSessionsRoutes } from "./sessions";

const JWT_SECRET = new TextEncoder().encode("session-share-test-secret");

function createSession(
  store: Store,
  sessionId = "session-1",
  namespace = "default",
) {
  return store.sessions.getOrCreateSession(
    `share-${sessionId}`,
    { path: "/repo", host: "host", flavor: "codex", name: "Shared session" },
    null,
    namespace,
    undefined,
    undefined,
    undefined,
    sessionId,
  );
}

async function ownerToken(namespace = "default"): Promise<string> {
  return await new SignJWT({ uid: 1, ns: namespace })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET);
}

function createApp(
  store: Store,
  engine: SyncEngine,
  isGuestTokenActive = (token: string) =>
    store.sessionShares.getActiveByToken(token) !== null,
) {
  const app = new Hono<WebAppEnv>();
  app.use("/api/*", createAuthMiddleware(JWT_SECRET, { isGuestTokenActive }));
  app.route(
    "/api",
    createSessionShareRoutes({
      store,
      jwtSecret: JWT_SECRET,
      getSyncEngine: () => engine,
    }),
  );
  app.route(
    "/api",
    createSessionsRoutes(() => engine),
  );
  app.get("/api/machines", (c) => c.json({ machines: [] }));
  return app;
}

describe("session share routes", () => {
  it("rate-limits repeated verification failures per share token", async () => {
    resetSessionShareExchangeRateLimitForTests();
    const store = new Store(":memory:");
    const session = createSession(store);
    const engine = {
      resolveSessionAccess: () => ({ ok: true, sessionId: session.id, session }),
      getSessionsByNamespace: () => [session],
      getFutureScheduledMessageCounts: () => new Map(),
      getNextScheduledAtBySessionIds: () => new Map(),
    } as unknown as SyncEngine;
    const app = createApp(store, engine);
    const owner = await ownerToken();
    const created = await app.request("/api/session-shares", {
      method: "POST",
      headers: {
        authorization: `Bearer ${owner}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId: session.id }),
    });
    const { share, accessCode } = (await created.json()) as {
      share: { shareToken: string };
      accessCode: string;
    };
    let lastStatus = 0;
    for (let index = 0; index < 21; index += 1) {
      const response = await app.request(
        `/api/public/session-shares/${share.shareToken}/exchange`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessCode: accessCode === "000000" ? "999999" : "000000" }),
        },
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
    store.close();
  });

  it("creates, exchanges, scopes, rotates, and revokes a collaborative share", async () => {
    const store = new Store(":memory:");
    const session = createSession(store);
    const otherSession = createSession(store, "session-2");
    const engine = {
      resolveSessionAccess: (sessionId: string, namespace: string) => {
        const selected =
          sessionId === session.id
            ? session
            : sessionId === otherSession.id
              ? otherSession
              : null;
        if (!selected) return { ok: false, reason: "not-found" as const };
        if (selected.namespace !== namespace)
          return { ok: false, reason: "access-denied" as const };
        return { ok: true as const, sessionId: selected.id, session: selected };
      },
      getSessionsByNamespace: (namespace: string) =>
        [session, otherSession].filter((item) => item.namespace === namespace),
      getFutureScheduledMessageCounts: () => new Map(),
      getNextScheduledAtBySessionIds: () => new Map(),
    } as unknown as SyncEngine;
    const app = createApp(store, engine);
    const owner = await ownerToken();

    const created = await app.request("/api/session-shares", {
      method: "POST",
      headers: {
        authorization: `Bearer ${owner}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId: session.id }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      share: { id: string; shareToken: string };
      accessCode: string;
    };
    expect(createdBody.accessCode).toMatch(/^\d{6}$/);

    const exchanged = await app.request(
      `/api/public/session-shares/${createdBody.share.shareToken}/exchange`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode: createdBody.accessCode }),
      },
    );
    expect(exchanged.status).toBe(200);
    const guestToken = ((await exchanged.json()) as { token: string }).token;

    const guestSessions = await app.request("/api/sessions", {
      headers: { authorization: `Bearer ${guestToken}` },
    });
    expect(guestSessions.status).toBe(200);
    expect(
      (
        (await guestSessions.json()) as { sessions: Array<{ id: string }> }
      ).sessions.map((item) => item.id),
    ).toEqual([session.id]);

    const guestGlobal = await app.request("/api/machines", {
      headers: { authorization: `Bearer ${guestToken}` },
    });
    expect(guestGlobal.status).toBe(403);

    const second = await app.request("/api/session-shares", {
      method: "POST",
      headers: {
        authorization: `Bearer ${owner}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId: session.id }),
    });
    const secondBody = (await second.json()) as {
      share: { id: string; shareToken: string };
      accessCode: string;
    };
    expect(secondBody.share.shareToken).not.toBe(createdBody.share.shareToken);

    const oldGuest = await app.request("/api/sessions", {
      headers: { authorization: `Bearer ${guestToken}` },
    });
    expect(oldGuest.status).toBe(401);

    const revoke = await app.request(
      `/api/session-shares/${secondBody.share.id}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${owner}` },
      },
    );
    expect(revoke.status).toBe(200);
    store.close();
  });

  it("rejects an invalid access code without revealing the session", async () => {
    const store = new Store(":memory:");
    const session = createSession(store);
    const engine = {
      resolveSessionAccess: () => ({
        ok: true,
        sessionId: session.id,
        session,
      }),
      getSessionsByNamespace: () => [session],
      getFutureScheduledMessageCounts: () => new Map(),
      getNextScheduledAtBySessionIds: () => new Map(),
    } as unknown as SyncEngine;
    const app = createApp(store, engine);
    const owner = await ownerToken();
    const created = await app.request("/api/session-shares", {
      method: "POST",
      headers: {
        authorization: `Bearer ${owner}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId: session.id }),
    });
    const { share, accessCode } = (await created.json()) as {
      share: { shareToken: string };
      accessCode: string;
    };

    const response = await app.request(
      `/api/public/session-shares/${share.shareToken}/exchange`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode: accessCode === "000000" ? "999999" : "000000" }),
      },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "invalid_access_code",
    });
    store.close();
  });
});
