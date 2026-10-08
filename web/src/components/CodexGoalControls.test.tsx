import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ThreadGoal } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { CodexGoalControls } from './CodexGoalControls'

const goal: ThreadGoal = { threadId: 'root', objective: 'Ship the fix', status: 'paused', tokenBudget: 10000,
    tokensUsed: 350, timeUsedSeconds: 12, createdAt: 1, updatedAt: 2 }

function show(onAction: Parameters<typeof CodexGoalControls>[0]['onAction'], status: ThreadGoal['status'] = 'paused') {
    return render(<I18nProvider><CodexGoalControls goal={{ ...goal, status }} onAction={onAction} /></I18nProvider>)
}

describe('Codex Goal controls', () => {
    it('edits the current objective and budget without sending a resume action', async () => {
        const action = vi.fn(async () => {})
        show(action)
        fireEvent.click(screen.getByRole('button', { name: 'Edit Goal' }))
        const dialog = screen.getByRole('dialog')
        expect(within(dialog).getByLabelText('Objective')).toHaveValue(goal.objective)
        expect(within(dialog).getByLabelText('Token budget (optional)')).toHaveValue(10000)
        fireEvent.change(within(dialog).getByLabelText('Objective'), { target: { value: 'Ship with tests' } })
        fireEvent.change(within(dialog).getByLabelText('Token budget (optional)'), { target: { value: '' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(action).toHaveBeenCalledWith({ action: 'update', objective: 'Ship with tests', tokenBudget: null }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('keeps edits on native failure and validates the objective', async () => {
        const action = vi.fn(async () => { throw new Error('Codex disconnected') })
        show(action)
        fireEvent.click(screen.getByRole('button', { name: 'Edit Goal' }))
        const objective = screen.getByLabelText('Objective')
        fireEvent.change(objective, { target: { value: 'Keep this draft' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Codex disconnected'))
        expect(objective).toHaveValue('Keep this draft')
        action.mockClear()
        fireEvent.change(objective, { target: { value: ' ' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
        expect(screen.getByRole('alert')).toHaveTextContent('1–4000')
        expect(action).not.toHaveBeenCalled()
    })

    it('pauses an active Goal and disables other operations until confirmed', async () => {
        let finish!: () => void
        const action = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
        show(action, 'active')
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
        expect(action).toHaveBeenCalledWith({ action: 'pause' })
        expect(screen.getByRole('button', { name: 'Edit Goal' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Delete Goal' })).toBeDisabled()
        finish()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Goal' })).toBeEnabled())
    })

    it('resumes a paused Goal', async () => {
        const action = vi.fn(async () => {})
        show(action)
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
        await waitFor(() => expect(action).toHaveBeenCalledWith({ action: 'resume' }))
    })

    it('deletes only after confirmation and keeps failed deletion retryable', async () => {
        const action = vi.fn(async () => { throw new Error('Goal clear failed') })
        show(action)
        fireEvent.click(screen.getByRole('button', { name: 'Delete Goal' }))
        expect(action).not.toHaveBeenCalled()
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
        expect(action).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Delete Goal' }))
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Goal' }))
        await waitFor(() => expect(screen.getByText('Goal clear failed')).toBeInTheDocument())
        expect(action).toHaveBeenCalledWith({ action: 'clear' })
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Goal' })).toBeEnabled()
    })
})
