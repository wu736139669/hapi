import { useEffect, useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'

/** Minimal text-entry dialog for joining, changing, or renaming a group. */
export function SessionGroupDialog({ isOpen, onClose, currentName, existingNames = [], onSave, isPending }: {
    isOpen: boolean
    onClose: () => void
    currentName: string
    existingNames?: string[]
    onSave: (name: string) => Promise<void>
    isPending?: boolean
}) {
    const { t } = useTranslation()
    const [draft, setDraft] = useState(currentName)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!isOpen) return
        setDraft(currentName)
        setError(null)
        setSaving(false)
    }, [isOpen, currentName])

    const submit = async () => {
        if (saving || isPending) return
        const name = draft.trim()
        if (!name) return
        setSaving(true)
        setError(null)
        try {
            await onSave(name)
            onClose()
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t('sessions.group.failed'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={open => { if (!open && !saving) onClose() }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{currentName ? t('session.action.renameGroup') : t('session.action.joinGroup')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={event => { event.preventDefault(); void submit() }} className="flex flex-col gap-3">
                    <label htmlFor="hapi-group-name" className="text-sm font-medium">{t('sessions.group.nameLabel')}</label>
                    <input
                        id="hapi-group-name"
                        autoFocus
                        list="hapi-group-suggestions"
                        value={draft}
                        maxLength={64}
                        onChange={event => setDraft(event.target.value)}
                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                    />
                    <datalist id="hapi-group-suggestions">
                        {existingNames.map(name => <option key={name} value={name} />)}
                    </datalist>
                    {existingNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                            {existingNames.map(name => (
                                <button
                                    key={name}
                                    type="button"
                                    onClick={() => setDraft(name)}
                                    className="rounded-full border border-[var(--app-border)] px-2 py-0.5 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]"
                                >
                                    {name}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    {error ? <div role="alert" className="text-xs text-red-600">{error}</div> : null}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>{t('button.cancel')}</Button>
                        <Button type="submit" disabled={!draft.trim() || saving || isPending}>{t('button.save')}</Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
