const SESSION_GUEST_PREFIX = "hapi_session_guest::";
const SESSION_GUEST_SESSION_PREFIX = "hapi_session_guest_session::";

export type SessionGuestAuth = {
  token: string;
  sessionId: string;
  shareToken?: string;
};

function key(shareToken: string): string {
  return `${SESSION_GUEST_PREFIX}${shareToken}`;
}
function sessionKey(sessionId: string): string {
  return `${SESSION_GUEST_SESSION_PREFIX}${sessionId}`;
}

export function saveSessionGuest(
  shareToken: string,
  auth: Omit<SessionGuestAuth, "shareToken">,
): void {
  const value = JSON.stringify({ ...auth, shareToken });
  try {
    sessionStorage.setItem(key(shareToken), value);
    sessionStorage.setItem(sessionKey(auth.sessionId), value);
  } catch {
    /* ignore */
  }
}

function parse(raw: string | null): SessionGuestAuth | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionGuestAuth>;
    return typeof parsed.token === "string" &&
      typeof parsed.sessionId === "string"
      ? {
          token: parsed.token,
          sessionId: parsed.sessionId,
          shareToken:
            typeof parsed.shareToken === "string"
              ? parsed.shareToken
              : undefined,
        }
      : null;
  } catch {
    return null;
  }
}

export function readSessionGuest(shareToken: string): SessionGuestAuth | null {
  try {
    return parse(sessionStorage.getItem(key(shareToken)));
  } catch {
    return null;
  }
}

export function readSessionGuestBySession(
  sessionId: string,
): SessionGuestAuth | null {
  try {
    return parse(sessionStorage.getItem(sessionKey(sessionId)));
  } catch {
    return null;
  }
}

export function clearSessionGuest(
  shareToken: string,
  sessionId?: string,
): void {
  try {
    sessionStorage.removeItem(key(shareToken));
    if (sessionId) sessionStorage.removeItem(sessionKey(sessionId));
  } catch {
    /* ignore */
  }
}
