import type { ReactNode } from 'react'
import { useTranslation } from '@/lib/use-translation'

/** Minimal centered modal shell used by the team dialogs. */
export function TeamDialog(props: {
    open: boolean
    title: string
    onClose: () => void
    children: ReactNode
    footer?: ReactNode
}) {
    const { t } = useTranslation()
    if (!props.open) return null
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={props.onClose}>
            <div
                className="w-full max-w-[420px] rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)] shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-[var(--app-divider)] px-4 py-3">
                    <span className="text-sm font-semibold text-[var(--app-fg)]">{props.title}</span>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        aria-label={t('button.cancel')}
                    >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="px-4 py-3">{props.children}</div>
                {props.footer ? (
                    <div className="flex justify-end gap-2 border-t border-[var(--app-divider)] px-4 py-3">{props.footer}</div>
                ) : null}
            </div>
        </div>
    )
}
