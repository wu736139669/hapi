// Real production screens. Only the API transport and synthetic session data are replaced.
import React, { createContext, useContext, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter, useNavigate } from '@tanstack/react-router'
import { toSessionSummary } from '@hapi/protocol'
import { ApiClient } from '../src/api/client'
import type { Session, DecryptedMessage } from '../src/types/api'
import { I18nProvider } from '../src/lib/i18n-context'
import { AppContextProvider } from '../src/lib/app-context'
import { ToastProvider } from '../src/lib/toast-context'
import { FilePreviewHost } from '../src/components/FilePreviewModal'
import { SessionList } from '../src/components/SessionList'
import { SessionChat } from '../src/components/SessionChat'
import SettingsLayout from '../src/routes/settings/layout'
import SettingsDisplayPage from '../src/routes/settings/display'
import SettingsHubPage from '../src/routes/settings'
import { initializeTheme } from '../src/hooks/useTheme'
import { initializeThemeColors } from '../src/hooks/useThemeColors'
import { initializeChatSurfaceColors } from '../src/hooks/useChatSurfaceColors'
import { useViewportHeight } from '../src/hooks/useViewportHeight'
import { parseAppearanceSkin, setAppearanceSkin } from '../src/lib/appearanceSkin'
import '../src/index.css'

const params = new URLSearchParams(location.search)
if (params.has('skin')) setAppearanceSkin(parseAppearanceSkin(params.get('skin')))
if (params.has('appearance')) localStorage.setItem('hapi-appearance', params.get('appearance') ?? 'light')
initializeTheme()
initializeThemeColors()
initializeChatSurfaceColors()

const createdAt = Date.now() - 240_000
const request = { tool: 'Bash', arguments: { command: 'bun run test:web', description: 'Run the web tests' }, createdAt: createdAt + 4000 }
let currentSession: Session = {
    id: 'forest-session', namespace: 'fixture', seq: 3, createdAt, updatedAt: createdAt + 4000,
    active: true, activeAt: createdAt, thinking: false, thinkingAt: 0, model: null, effort: null, modelReasoningEffort: null, serviceTier: null,
    metadata: { path: '/workspace/hapi', host: 'Development Mac', flavor: 'claude', name: '把想法变成新的冒险', machineId: 'fixture-machine' },
    metadataVersion: 1, agentStateVersion: 1,
    agentState: { requests: { 'approval-1': request } },
    todos: [{ id: 'one', content: '整理界面与状态', status: 'completed', priority: 'medium' }, { id: 'two', content: '验证手机体验', status: 'in_progress', priority: 'medium' }],
}

const initialMessages: DecryptedMessage[] = [
    { id: 'user-1', seq: 1, localId: 'local-1', createdAt, content: { role: 'user', content: { type: 'text', text: '帮我整理这个项目的界面，再检查一下测试。' } } },
    { id: 'assistant-1', seq: 2, localId: null, createdAt: createdAt + 2000, content: { role: 'agent', content: { type: 'output', data: {
        type: 'assistant', uuid: 'assistant-1', parentUuid: null,
        message: { role: 'assistant', content: [{ type: 'text', text: '### 一起完成这次冒险\n\n已经整理好界面结构，接下来检查手机上的阅读和操作体验。\n\n- 列表保留项目、模型与任务状态\n- 聊天支持长文字、代码和审批\n\n```typescript\nconst adventure = {\n    status: "ready",\n    next: "run the tests",\n}\n```\n\n测试命令需要你批准后执行。' }] },
    } } } },
]

type Probe = { requests: { path: string; method: string }[]; sent: string[]; patch: (value: Partial<Session>) => void }
declare global { interface Window { __adventure: Probe } }
window.__adventure = { requests: [], sent: [], patch: () => {} }
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/health') return originalFetch(input, init)
    const path = url.pathname
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    window.__adventure.requests.push({ path, method })
    let body: unknown = { success: true, entries: [], models: [], files: [], messages: [], settings: {} }
    if (path === '/api/sessions') body = { sessions: demoSessions() }
    else if (path === '/api/machines') body = { machines: [] }
    else if (path.endsWith('/git-status')) body = { success: true, stdout: '## feat/mobile-adventure-skin\n M web/src/index.css', stderr: '', exitCode: 0 }
    else if (path.endsWith('/share')) body = { share: null }
    else if (path.endsWith('/abort')) currentSession = { ...currentSession, thinking: false }
    else if (path.includes('/permissions/')) {
        const requestId = decodeURIComponent(path.split('/').at(-2) ?? '')
        const requests = { ...currentSession.agentState?.requests }
        const pending = requests[requestId]
        delete requests[requestId]
        currentSession = { ...currentSession, agentState: { requests, completedRequests: {
            ...currentSession.agentState?.completedRequests,
            ...(pending ? { [requestId]: { ...pending, status: path.endsWith('/deny') ? 'denied' : 'approved', completedAt: Date.now() } } : {}),
        } } }
    } else if (path === `/api/sessions/${currentSession.id}`) body = { session: currentSession }
    else if (path === '/health') body = { status: 'ok', capabilities: {} }
    if (path.endsWith('/abort') || path.includes('/permissions/')) window.__adventure.patch(currentSession)
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
const api = new ApiClient('synthetic-fixture-token', { baseUrl: location.origin })

function demoSessions() {
    return [
        toSessionSummary(currentSession),
        ...(params.has('dense') ? Array.from({ length: 10 }, (_, index) => toSessionSummary({
            ...currentSession,
            id: `forest-extra-${index}`,
            agentState: null,
            thinking: index < 4,
            metadata: { ...currentSession.metadata!, name: ['整理项目与功能', '检查界面和测试', '继续今天的开发'][index % 3], path: `/workspace/project-${index + 1}` },
        })) : []),
        toSessionSummary({ ...currentSession, id: 'forest-working', thinking: true, agentState: null,
            metadata: { ...currentSession.metadata!, flavor: 'codex', name: '为首页添加一点森林的气息', path: '/workspace/garden' } }),
        toSessionSummary({ ...currentSession, id: 'forest-idle', agentState: null,
            metadata: { ...currentSession.metadata!, flavor: 'gemini', name: '整理今天的新想法', path: '/workspace/notes' } }),
        toSessionSummary({ ...currentSession, id: 'forest-long', active: false, agentState: null,
            metadata: { ...currentSession.metadata!, name: '一个很长的中文会话标题，用来确认小屏幕上依然可以清楚阅读', path: '/workspace/a-long-project-name/packages/application' } }),
    ]
}

type FixtureState = { session: Session; refresh: () => void; messages: DecryptedMessage[]; send: (text: string) => Promise<{ attemptId: string }> }
const FixtureContext = createContext<FixtureState | null>(null)
function useFixture() { const value = useContext(FixtureContext); if (!value) throw new Error('Fixture context missing'); return value }

function FixtureRoot() {
    useViewportHeight()
    const [session, setSession] = useState(currentSession)
    const [messages, setMessages] = useState(initialMessages)
    const refresh = () => setSession({ ...currentSession })
    window.__adventure.patch = patch => { currentSession = { ...currentSession, ...patch }; refresh() }
    const send = async (text: string) => {
        const id = `sent-${messages.length}`
        window.__adventure.sent.push(text)
        setMessages(previous => [...previous, { id, seq: previous.length + 1, localId: id, createdAt: Date.now(), content: { role: 'user', content: { type: 'text', text } } }])
        currentSession = { ...currentSession, thinking: true }
        refresh()
        return { attemptId: id }
    }
    return <FixtureContext.Provider value={{ session, refresh, messages, send }}><Outlet /></FixtureContext.Provider>
}

function ListPage() {
    const { refresh } = useFixture()
    const navigate = useNavigate()
    return <div className="flex h-full min-h-0 flex-col">
        <SessionList sessions={params.get('view') === 'empty' ? [] : demoSessions()} compact={params.has('compact')} isLoading={false} api={api} onRefresh={refresh}
            onSelect={() => void navigate({ to: '/sessions/$sessionId', params: { sessionId: currentSession.id } })}
            onNewSession={() => void navigate({ to: '/sessions/$sessionId', params: { sessionId: currentSession.id } })}
            headerActions={<button type="button" aria-label="Settings" className="h-11 px-3 text-sm" onClick={() => void navigate({ to: '/settings/display' })}>⚙</button>} />
    </div>
}

function ChatPage() {
    const { session, messages, refresh, send } = useFixture()
    const navigate = useNavigate()
    return <SessionChat api={api} session={session} messages={messages} messagesWarning={null}
        hasMoreMessages={false} isSyncingTail={false} isLoadingMoreMessages={false}
        isSending={false} sendSettlement={null} viewMode="tail" messagesVersion={messages.length}
        historyVersion={0} tailRevision={0} onBack={() => void navigate({ to: '/sessions' })}
        onRefresh={refresh} onLoadMore={async () => ({ kind: 'stopped', reason: 'exhausted' })} onCancelLoadMore={() => {}}
        onSend={send} onViewModeChange={() => {}} />
}

const rootRoute = createRootRoute({ component: FixtureRoot })
const listRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sessions', component: ListPage })
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sessions/$sessionId', component: ChatPage })
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsLayout })
const settingsIndexRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/', component: SettingsHubPage })
const settingsDisplayRoute = createRoute({ getParentRoute: () => settingsRoute, path: 'display', component: SettingsDisplayPage })
const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, chatRoute, settingsRoute.addChildren([settingsIndexRoute, settingsDisplayRoute])]),
    history: createMemoryHistory({ initialEntries: [params.get('view') === 'chat' ? `/sessions/${currentSession.id}` : params.get('view') === 'settings' ? '/settings/display' : '/sessions'] }),
})

createRoot(document.getElementById('root')!).render(
    <React.StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AppContextProvider value={{ api, token: 'synthetic-fixture-token', baseUrl: location.origin }}>
            <ToastProvider><I18nProvider><FilePreviewHost><RouterProvider router={router} /></FilePreviewHost></I18nProvider></ToastProvider>
        </AppContextProvider>
    </QueryClientProvider></React.StrictMode>,
)
