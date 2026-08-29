import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { ChatToolCall } from '@/chat/types'
import { I18nProvider } from '@/lib/i18n-context'
import { AskUserQuestionFooter } from './AskUserQuestionFooter'

function questionTool(): ChatToolCall {
    return {
        id: 'tool-call-1',
        name: 'ask_user_question',
        state: 'running',
        input: {
            questions: [{
                id: 'audience',
                question: 'Who should receive this?',
                detail: 'Choose the intended audience.',
                options: [{ label: 'App users', description: 'Creators using the app' }]
            }]
        },
        createdAt: 1,
        startedAt: 1,
        completedAt: null,
        execStartedAt: null,
        execCompletedAt: null,
        description: null,
        permission: {
            id: 'tool-call-1',
            status: 'pending'
        }
    }
}

describe('AskUserQuestionFooter DSH bridge', () => {
    it('submits a skipped question as an empty answer under its stable id', async () => {
        localStorage.setItem('hapi-lang', 'en')
        const approvePermission = vi.fn(async () => {})
        const onDone = vi.fn()

        render(
            <I18nProvider>
                <AskUserQuestionFooter
                    api={{ approvePermission } as unknown as ApiClient}
                    sessionId="session-1"
                    tool={questionTool()}
                    disabled={false}
                    allowSkip
                    onDone={onDone}
                />
            </I18nProvider>
        )

        expect(screen.getByText('Choose the intended audience.')).toBeInTheDocument()
        expect(screen.getByText('Creators using the app')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Skip question' }))

        await waitFor(() => {
            expect(approvePermission).toHaveBeenCalledWith(
                'session-1',
                'tool-call-1',
                { answers: { audience: [] } }
            )
        })
        expect(onDone).toHaveBeenCalledOnce()
    })
})
