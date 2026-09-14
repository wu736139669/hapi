import type { Session } from '../sync/syncEngine'
import type { SessionEndReason } from '@hapi/protocol'
import type { NotificationSendContext } from './notificationSendContext'

export type TaskNotification = {
    summary: string
    status?: string
}

/**
 * A team message that needs the human's attention (explicit `to: human` or a
 * `decision`). Delivered out-of-band by channels that support it.
 */
export type TeamAttentionNotification = {
    namespace: string
    teamId: string
    teamName: string
    seq: number
    kind: string
    fromRole: string
    text: string
}

export type NotificationChannel = {
    sendReady: (session: Session, ctx?: NotificationSendContext) => Promise<void>
    sendPermissionRequest: (session: Session, ctx?: NotificationSendContext) => Promise<void>
    sendTaskNotification: (session: Session, notification: TaskNotification, ctx?: NotificationSendContext) => Promise<void>
    sendSessionCompletion?: (session: Session, reason: SessionEndReason) => Promise<void>
    /** Optional: channels that cannot render team attention may omit this. */
    sendTeamAttention?: (notification: TeamAttentionNotification, ctx?: NotificationSendContext) => Promise<void>
}

export type NotificationHubOptions = {
    readyCooldownMs?: number
    permissionDebounceMs?: number
}
