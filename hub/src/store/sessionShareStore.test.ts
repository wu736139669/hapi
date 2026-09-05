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
});
