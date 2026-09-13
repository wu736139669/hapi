import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { safeCopyToClipboard } from "@/lib/clipboard";
import type { SessionShare } from "@/types/api";
import { useTranslation } from "@/lib/use-translation";
import { formatAbsoluteDateTime } from "@/lib/relativeTime";

type Props = {
  isOpen: boolean;
  share: SessionShare | null;
  accessCode: string | null;
  shareUrl: string | null;
  onClose: () => void;
  onRevoke?: () => void;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
};

export function SessionShareDialog(props: Props) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();
  const copy = async (value: string) => {
    try {
      await safeCopyToClipboard(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sessionShare.title")}</DialogTitle>
          <DialogDescription>{t("sessionShare.description")}</DialogDescription>
        </DialogHeader>
        {props.shareUrl ? (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              <span className="font-medium">{t("sessionShare.active")}</span>
              <span>{t("sessionShare.noExpiry")}</span>
            </div>
            <div>
              <div className="mb-1 text-xs text-[var(--app-hint)]">
                {t("sessionShare.link")}
              </div>
              <button
                type="button"
                onClick={() => void copy(props.shareUrl!)}
                className="w-full break-all rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-left text-[var(--app-link)]"
              >
                {props.shareUrl}
              </button>
            </div>
            <div>
              <div className="mb-1 text-xs text-[var(--app-hint)]">
                {t("sessionShare.code")}
              </div>
              {props.accessCode ? (
                <button
                  type="button"
                  onClick={() => void copy(props.accessCode!)}
                  className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-center font-mono text-2xl tracking-[0.3em] text-[var(--app-fg)]"
                >
                  {props.accessCode}
                </button>
              ) : (
                <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-center text-xs text-[var(--app-hint)]">
                  {t("sessionShare.codeUnavailable")}
                </div>
              )}
            </div>
            {props.share ? (
              <div className="text-xs text-[var(--app-hint)]">
                {t("sessionShare.createdAt", { time: formatAbsoluteDateTime(props.share.createdAt) ?? "—" })}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--app-hint)]">
                {copied ? t("sessionShare.copied") : t("sessionShare.copyHint")}
              </span>
              <div className="flex items-center gap-1">
                {props.onRegenerate ? (
                  <button
                    type="button"
                    onClick={props.onRegenerate}
                    disabled={props.isRegenerating}
                    className="rounded-lg px-3 py-2 text-sm text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                  >
                    {props.isRegenerating ? t("sessionShare.regenerating") : t("sessionShare.regenerate")}
                  </button>
                ) : null}
                {props.onRevoke ? (
                  <button
                    type="button"
                    onClick={props.onRevoke}
                    className="rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-500/10"
                  >
                    {t("sessionShare.revoke")}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--app-hint)]">{t("loading")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
