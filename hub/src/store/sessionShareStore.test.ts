import { describe, expect, it } from "bun:test";
import { Store } from "./index";

describe("SessionShareStore", () => {
  it("rotates codes and verifies only the active share", () => {
    const store = new Store(":memory:");
    const session = store.sessions.getOrCreateSession(
      "share-test",
      { flavor: "claude" },
      null,
      "default",
    );
    const first = store.sessionShares.createShare(session.id, "default");
    expect(first.accessCode).toMatch(/^\d{6}$/);
    expect(
      store.sessionShares.verifyCode(first.share.shareToken, first.accessCode)
        ?.sessionId,
    ).toBe(session.id);

    const second = store.sessionShares.createShare(session.id, "default");
    expect(second.share.shareToken).not.toBe(first.share.shareToken);
    expect(
      store.sessionShares.verifyCode(first.share.shareToken, first.accessCode),
    ).toBeNull();
    expect(
      store.sessionShares.verifyCode(second.share.shareToken, second.accessCode)
        ?.sessionId,
    ).toBe(session.id);
    store.close();
  });

  it("lists active shares by namespace without revoked shares", () => {
    const store = new Store(":memory:");
    const firstSession = store.sessions.getOrCreateSession(
      "share-list-1",
      { flavor: "claude" },
      null,
      "default",
    );
    const secondSession = store.sessions.getOrCreateSession(
      "share-list-2",
      { flavor: "codex" },
      null,
      "default",
    );
    const otherNamespaceSession = store.sessions.getOrCreateSession(
      "share-list-other",
      { flavor: "codex" },
      null,
      "other",
    );

    const first = store.sessionShares.createShare(firstSession.id, "default");
    const second = store.sessionShares.createShare(secondSession.id, "default");
    store.sessionShares.createShare(otherNamespaceSession.id, "other");
    store.sessionShares.revokeById(first.share.id, "default");

    expect(store.sessionShares.getActiveByNamespace("default").map((share) => share.id)).toEqual([
      second.share.id,
    ]);
    expect(store.sessionShares.getActiveByNamespace("other")).toHaveLength(1);
    store.close();
  });
});
