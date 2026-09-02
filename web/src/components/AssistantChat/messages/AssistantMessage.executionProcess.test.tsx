import {
    AssistantRuntimeProvider,
    ThreadPrimitive,
    useExternalStoreRuntime,
    type ThreadAssistantMessagePart,
    type ThreadMessageLike
} from '@assistant-ui/react'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HappyChatProvider, type HappyChatContextValue } from '@/components/AssistantChat/context'
import { I18nProvider } from '@/lib/i18n-context'
import { HappyAssistantMessage } from './AssistantMessage'

vi.mock('@/components/assistant-ui/reasoning', () => ({
    Reasoning: () => <div>Reasoning content</div>,
    ReasoningGroup: (props: { children: ReactNode }) => (
        <div data-testid="reasoning-group">{props.children}</div>
    )
}))

vi.mock('@/components/AssistantChat/messages/ToolMessage', () => ({
    HappyToolMessage: (props: { toolName: string }) => <div>Tool: {props.toolName}</div>
}))

vi.mock('@/components/AssistantChat/messages/NotifySummaryText', () => ({
    NotifySummaryText: (props: { text: string }) => <div>{props.text}</div>
}))

vi.mock('@/components/AssistantChat/messages/MessageActions', () => ({
    MessageActions: () => null
}))

const chatContext = {
    metadata: null,
    showSessionSummaryInChat: false,
    disabled: false,
    onRefresh: () => {},
    hasMoreMessages: false,
    isSyncingTail: false,
    isLoadingMoreMessages: false,
    loadOlderMessagesPreservingScroll: async () => 'terminal-stop'
} as unknown as HappyChatContextValue

function MessageHarness(props: { content: ThreadAssistantMessagePart[] }) {
    const messages: ThreadMessageLike[] = [{
        id: 'assistant-message',
        role: 'assistant',
        content: props.content
    }]
    const runtime = useExternalStoreRuntime({
        messages,
        convertMessage: (message) => message,
        onNew: async () => {}
    })

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <HappyChatProvider value={chatContext}>
                <I18nProvider>
                    <ThreadPrimitive.Messages
                        components={{
                            UserMessage: () => null,
                            AssistantMessage: HappyAssistantMessage,
                            SystemMessage: () => null
                        }}
                    />
                </I18nProvider>
            </HappyChatProvider>
        </AssistantRuntimeProvider>
    )
}

describe('HappyAssistantMessage execution process grouping', () => {
    it('keeps reasoning, tools, and process text in the panel while the final answer stays outside', () => {
        render(
            <MessageHarness
                content={[
                    { type: 'text', text: 'Checking the repository' },
                    { type: 'reasoning', text: 'Need to inspect the implementation' },
                    {
                        type: 'tool-call',
                        toolCallId: 'tool-1',
                        toolName: 'Bash',
                        args: {},
                        argsText: '{}'
                    },
                    { type: 'text', text: 'Final answer' }
                ]}
            />
        )

        const panel = screen.getByRole('region', { name: 'Execution process' })
        expect(within(panel).getByText('Checking the repository')).toBeInTheDocument()
        expect(within(panel).getByText('Reasoning content')).toBeInTheDocument()
        expect(within(panel).getByText('Tool: Bash')).toBeInTheDocument()
        expect(within(panel).queryByText('Final answer')).not.toBeInTheDocument()
        expect(screen.getByText('Final answer')).toBeInTheDocument()
    })

    it('retains the panel for a completed response containing only one reasoning part', () => {
        render(
            <MessageHarness
                content={[{ type: 'reasoning', text: 'Only reasoning' }]}
            />
        )

        expect(screen.getByRole('region', { name: 'Execution process' })).toBeInTheDocument()
        expect(screen.getByTestId('reasoning-group')).toBeInTheDocument()
    })

    it('does not add a panel around a plain final response', () => {
        render(
            <MessageHarness
                content={[{ type: 'text', text: 'Plain response' }]}
            />
        )

        expect(screen.queryByRole('region', { name: 'Execution process' })).not.toBeInTheDocument()
        expect(screen.getByText('Plain response')).toBeInTheDocument()
    })
})
