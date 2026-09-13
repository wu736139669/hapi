import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { safeCopyToClipboard } from '@/lib/clipboard'
import { formatAbsoluteDateTime } from '@/lib/relativeTime'
import { getSessionTitle } from '@/lib/sessionTitle'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import type { ApiClient } from '@/api/client'
import type { SessionShareListItem } from '@/types/api'

type Props = {
    isOpen: boolean
    shares: SessionShareListItem[]
    isLoading: boolean
    error?: string | null
    api: ApiClient | null
    baseUrl?: string
    onClose: () => void
    onSelectSession: (sessionId: string) => void
    onRevoked: (shareId: string) => void
}

function buildShareUrl(shareToken: string, baseUrl: string | undefined, locale: string): string {
    const origin = window.location.origin
    const configuredHub = baseUrl && baseUrl !== origin
        ? baseUrl
        : new URLSearchParams(window.location.search).get('hub')
    const params = new URLSearchParams()
    if (configuredHub) params.set('hub', configuredHub)
    params.set('lang', locale)
    const query = params.toString() ? `?${params.toString()}` : ''
    return `${origin}/shared-session/${encodeURIComponent(shareToken)}${query}`
}

export function SessionShareManagerDialog(props: Props) {
    const { t, locale } = useTranslation()
    const { addToast } = useToast()
    const [copiedShareId, setCopiedShareId] = useState<string | null>(null)
    const [revokingShareId, setRevokingShareId] = useState<string | null>(null)

    const copy = async (shareId: string, value: string) => {
        try {
            await safeCopyToClipboard(value)
            setCopiedShareId(shareId)
            window.setTimeout(() => setCopiedShareId((current) => current === shareId ? null : current), 1800)
        } catch {
            setCopiedShareId(null)
        }
    }

    const revoke = async (item: SessionShareListItem) => {
        if (!props.api || revokingShareId) return
        setRevokingShareId(item.share.id)
        try {
            await props.api.revokeSessionShare(item.share.id)
            props.onRevoked(item.share.id)
            addToast({
                title: t('sessionShare.revoke'),
                body: t('sessionShare.revoked'),
                sessionId: item.share.sessionId,
                url: `/sessions/${item.share.sessionId}`
            })
        } catch (error) {
            addToast({
                title: t('sessionShare.revokeFailed'),
                body: error instanceof Error ? error.message : t('dialog.error.default'),
                sessionId: item.share.sessionId,
                url: `/sessions/${item.share.sessionId}`
            })
        } finally {
            setRevokingShareId(null)
        }
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => { if (!open) props.onClose() }}>
            <DialogContent className="max-h-[min(82vh,680px)] max-w-xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('sessionShare.manageTitle')}</DialogTitle>
                    <DialogDescription>{t('sessionShare.manageDescription')}</DialogDescription>
                </DialogHeader>

                {props.isLoading ? (
                    <div className="py-8 text-center text-sm text-[var(--app-hint)]">{t('sessionShare.manageLoading')}</div>
                ) : props.error ? (
                    <div className="rounded-xl bg-red-500/10 px-4 py-4 text-sm text-red-600 dark:text-red-300">
                        {props.error}
                    </div>
                ) : props.shares.length === 0 ? (
                    <div className="rounded-xl bg-[var(--app-secondary-bg)] px-4 py-8 text-center text-sm text-[var(--app-hint)]">
                        {t('sessionShare.manageEmpty')}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {props.shares.map((item) => {
                            const session = item.session
                            const title = session ? getSessionTitle(session) : item.share.sessionId
                            const shareUrl = buildShareUrl(item.share.shareToken, props.baseUrl, locale)
                            const createdAt = formatAbsoluteDateTime(item.share.createdAt)
                            return (
                                <div key={item.share.id} className="rounded-xl bg-[var(--app-secondary-bg)] p-3">
                                    <div className="flex items-start gap-3">
                                        <button
                                            type="button"
                                            onClick={() => props.onSelectSession(item.share.sessionId)}
                                            className="min-w-0 flex-1 text-left"
                                        >
                                            <div className="truncate text-sm font-medium text-[var(--app-fg)]">{title}</div>
                                            <div className="mt-1 truncate text-xs text-[var(--app-hint)]">
                                                {session?.metadata?.path ?? item.share.sessionId}
                                            </div>
                                        </button>
                                        <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                                            {t('sessionShare.active')}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-xs text-[var(--app-hint)]">
                                        {t('sessionShare.noExpiry')}{createdAt ? ` · ${t('sessionShare.createdAt', { time: createdAt })}` : ''}
                                    </div>
                                    <div className="mt-3 flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void copy(item.share.id, shareUrl)}
                                            className="min-w-0 flex-1 truncate rounded-lg bg-[var(--app-bg)] px-3 py-2 text-left text-xs text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)]"
                                            title={shareUrl}
                                        >
                                            {copiedShareId === item.share.id ? t('sessionShare.copied') : shareUrl}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={revokingShareId === item.share.id}
                                            onClick={() => void revoke(item)}
                                            className="shrink-0 rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                                        >
                                            {revokingShareId === item.share.id ? t('sessionShare.revoking') : t('sessionShare.revoke')}
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
