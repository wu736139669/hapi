import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ApiClient } from "@/api/client";
import { useServerUrl } from "@/hooks/useServerUrl";
import { saveSessionGuest } from "@/lib/sessionGuest";
import { LoadingState } from "@/components/LoadingState";
import { useTranslation } from "@/lib/use-translation";

export default function SharedSessionPage() {
  const { shareToken } = useParams({ from: "/shared-session/$shareToken" });
  const { baseUrl } = useServerUrl();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  const submit = async () => {
    const normalized = code.replace(/\D/g, "").slice(0, 6);
    if (normalized.length !== 6) {
      setError(t("sessionShare.code"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const api = new ApiClient("", { baseUrl });
      const result = await api.exchangeSessionShare(shareToken, normalized);
      saveSessionGuest(shareToken, {
        token: result.token,
        sessionId: result.sessionId,
      });
      await navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: result.sessionId },
        search: { guest: true, share: shareToken },
        replace: true,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("sessionShare.invalid"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-[var(--app-bg)] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-[var(--app-fg)]">
          {t("sessionShare.join")}
        </h1>
        <p className="mt-2 text-sm text-[var(--app-hint)]">
          {t("sessionShare.joinDescription")}
        </p>
        <input
          autoFocus
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) =>
            setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          className="mt-5 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-3 text-center text-2xl tracking-[0.35em] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-link)]"
          placeholder="000000"
          aria-label={t("sessionShare.enterCode")}
        />
        {error ? (
          <div className="mt-3 text-sm text-red-500">{error}</div>
        ) : null}
        <button
          type="button"
          disabled={busy || code.length !== 6}
          onClick={() => void submit()}
          className="mt-5 w-full rounded-xl bg-[var(--app-button)] px-4 py-3 font-medium text-[var(--app-button-text)] disabled:opacity-50"
        >
          {busy ? (
            <LoadingState
              label={t("sessionShare.verify")}
              className="text-sm"
            />
          ) : (
            t("sessionShare.enter")
          )}
        </button>
      </div>
    </div>
  );
}
