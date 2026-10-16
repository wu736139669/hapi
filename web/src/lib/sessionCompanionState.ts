import { getPendingRequestKinds } from '@hapi/protocol'
import type { Session, SessionSummary } from '@/types/api'

export type SessionCompanionState = 'working' | 'permission' | 'input' | 'waiting' | 'background' | 'idle' | 'inactive'

/** Follow the session row's activity priority, including work + pending overlap. */
export function getSessionCompanionState(session: Session | SessionSummary): SessionCompanionState {
    if (!session.active) return 'inactive'
    if (session.thinking) return 'working'
    const kinds = 'pendingRequestKinds' in session ? session.pendingRequestKinds : getPendingRequestKinds(session)
    if (kinds.includes('permission')) return 'permission'
    if (kinds.includes('input')) return 'input'
    if ((session.backgroundTaskCount ?? 0) > 0) return 'background'
    const count = 'pendingRequestsCount' in session
        ? session.pendingRequestsCount
        : Object.keys(session.agentState?.requests ?? {}).length
    return count > 0 ? 'waiting' : 'idle'
}
