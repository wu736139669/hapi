import { useId, useState } from 'react'
import { CodexGoalRequestSchema, type CodexGoalRequest } from '@hapi/protocol/apiTypes'
import type { ThreadGoal } from '@/types/api'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/lib/use-translation'

export function CodexGoalControls({ goal, onAction }: {
    goal: ThreadGoal
    onAction: (action: CodexGoalRequest) => Promise<void>
}) {
    const { t } = useTranslation()
    const id = useId()
    const [editing, setEditing] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [objective, setObjective] = useState('')
    const [budget, setBudget] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const run = async (action: CodexGoalRequest) => {
        setError(null)
        setPending(true)
        try { await onAction(action) }
        finally { setPending(false) }
    }
    const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : t('dialog.error.default'))
    const openEditor = () => {
        setObjective(goal.objective)
        setBudget(goal.tokenBudget == null ? '' : String(goal.tokenBudget))
        setError(null)
        setEditing(true)
    }
    const save = async () => {
        const action = CodexGoalRequestSchema.safeParse({
            action: 'update', objective,
            tokenBudget: budget.trim() === '' ? null : Number(budget)
        })
        if (!action.success) { setError(t('session.goal.invalid')); return }
        try { await run(action.data); setEditing(false) }
        catch (reason) { report(reason) }
    }

    return (
        <div className="mt-2">
            <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" disabled={pending} onClick={openEditor}>{t('session.goal.edit')}</Button>
                <Button size="sm" variant="outline" disabled={pending}
                    onClick={() => void run({ action: goal.status === 'active' ? 'pause' : 'resume' }).catch(report)}>
                    {t(goal.status === 'active' ? 'session.goal.pause' : 'session.goal.resume')}
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => { setError(null); setDeleting(true) }}>
                    {t('session.goal.delete')}
                </Button>
            </div>
            {error && !editing ? <div role="alert" className="mt-2 text-xs text-red-600">{error}</div> : null}
            <Dialog open={editing} onOpenChange={open => { if (!pending) setEditing(open) }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{t('session.goal.edit')}</DialogTitle>
                        <DialogDescription>{t('session.goal.editDescription')}</DialogDescription>
                    </DialogHeader>
                    <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void save() }}>
                        <label htmlFor={`${id}-objective`} className="text-sm font-medium">{t('session.goal.objective')}</label>
                        <textarea id={`${id}-objective`} value={objective} onChange={event => setObjective(event.target.value)}
                            rows={5} required disabled={pending} autoFocus
                            className="w-full resize-y rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm" />
                        <label htmlFor={`${id}-budget`} className="text-sm font-medium">{t('session.goal.budget')}</label>
                        <input id={`${id}-budget`} type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1}
                            value={budget} onChange={event => setBudget(event.target.value)} disabled={pending}
                            placeholder={t('session.goal.unlimited')}
                            className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm" />
                        {error ? <div role="alert" className="text-sm text-red-600">{error}</div> : null}
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="secondary" disabled={pending} onClick={() => setEditing(false)}>{t('button.cancel')}</Button>
                            <Button type="submit" disabled={pending}>{t(pending ? 'session.goal.saving' : 'button.save')}</Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
            <ConfirmDialog isOpen={deleting} onClose={() => { if (!pending) setDeleting(false) }}
                title={t('session.goal.delete')} description={t('session.goal.deleteDescription')}
                confirmLabel={t('session.goal.delete')} confirmingLabel={t('session.goal.deleting')}
                onConfirm={() => run({ action: 'clear' })} isPending={pending} destructive />
        </div>
    )
}
