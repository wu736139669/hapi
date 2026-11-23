import { useMemo } from "react";
import { ApiClient } from "@/api/client";
import {
  readSessionGuest,
  readSessionGuestBySession,
} from "@/lib/sessionGuest";

export function useSessionGuestAuth(
  baseUrl: string,
  pathname: string,
  search: unknown,
): {
  auth: { token: string; sessionId: string; shareToken?: string } | null;
  api: ApiClient | null;
  shareToken: string | null;
} {
  const searchShare =
    search !== null &&
    typeof search === "object" &&
    typeof (search as { share?: unknown }).share === "string"
      ? (search as { share: string }).share
      : null;
  const sessionId = pathname.match(/^\/sessions\/([^/]+)/)?.[1] ?? null;
  // Storage parsing returns a fresh object on every render. Keep the parsed
  // auth value stable so consumers that key effects on ApiClient do not tear
  // down and recreate their requests on every state update.
  const auth = useMemo(
    () =>
      searchShare
        ? readSessionGuest(searchShare)
        : sessionId
          ? readSessionGuestBySession(decodeURIComponent(sessionId))
          : null,
    [searchShare, sessionId],
  );
  return useMemo(() => {
    if (!auth) return { auth: null, api: null, shareToken: null };
    return {
      auth,
      api: new ApiClient(auth.token, { baseUrl }),
      shareToken: auth.shareToken ?? searchShare,
    };
  }, [auth, baseUrl, searchShare]);
}
