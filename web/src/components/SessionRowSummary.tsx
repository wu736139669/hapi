import { useMemo, useSyncExternalStore } from 'react'
import type { SessionSummary } from '@/types/api'
import { AgentFlavorIcon } from '@/components/AgentFlavorIcon'
import { Spinner } from '@/components/Spinner'
import { InfoIcon, LoaderIcon, ScheduleIcon, StoppedBadgeIcon } from '@/components/icons'
import { HoverTooltip, SESSION_ROW_TOOLTIP_FOCUS_CLASS, useSessionRowTooltipIds } from '@/components/HoverTooltip'
import { getAttentionLabel, SessionAttentionIndicator, SessionRequestIcon } from '@/components/SessionAttentionIndicator'
import { classifySessionAttention, sessionIsUnread } from '@/lib/sessionAttention'
import { getSessionLastSeenAt, getSessionManualUnreadAt } from '@/lib/sessionLastSeen'
import { formatRelativeTime } from '@/lib/relativeTime'
import { formatScheduledTooltipDetail } from '@/lib/scheduledTime'
import { getCodexImportedAt, subscribeCodexImportedSessions } from '@/lib/codexImportedSessions'
import { useMinuteTick } from '@/hooks/useMinuteTick'
import { getSessionTitle } from '@/lib/sessionTitle'
import { useTranslation } from '@/lib/use-translation'
import { getWorktreeSessionLabel } from '@/lib/sessionWorktreeLabel'
import { SessionForestCompanion } from '@/components/skins/ForestCompanion'
import {
    attachedJobFraction,
    formatAttachedJobProgress,
    isAttachedJobStale
} from '@/lib/attachedJob'

function BulbIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.2 1 2h6c0-.8.4-1.4 1-2a7 7 0 0 0-4-12Z" />
        </svg>
    )
}

function getTodoProgress(session: SessionSummary): { completed: number; total: number } | null {
    if (!session.todoProgress) return null
    if (session.todoProgress.completed === session.todoProgress.total) return null
    return session.todoProgress
}

function formatCodexImportedRelativeTime(
    value: number,
    t: (key: string, params?: Record<string, string | number>) => string
): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.importedFromCodex.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.importedFromCodex.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.importedFromCodex.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.importedFromCodex.daysAgo', { n: days })
    return formatRelativeTime(value, t)
}

function getSessionTimeLabel(
    session: SessionSummary,
    importedAt: number | null,
    t: (key: string, params?: Record<string, string | number>) => string
): string | null {
    if (importedAt !== null) {
        return formatCodexImportedRelativeTime(importedAt, t)
    }
    return formatRelativeTime(session.updatedAt, t)
}

const PRESENCE_BADGE_CLASS = {
    working: 'bg-[var(--app-badge-success-text)] animate-pulse',
    background: 'bg-blue-400 animate-pulse',
    waiting: 'border-2 border-[var(--app-badge-success-text)] bg-[var(--app-bg)]',
    stopped: 'bg-[var(--app-bg)] text-[var(--app-hint)]',
} as const

/**
 * Presentational session row — same chrome as the sidebar SessionItem body
 * (flavor icon with presence badge, title, request/schedule symbols, todos,
 * relative time, path, optional attached-job meter). Visual language matches
 * the native apps: unread is a semibold title + accent time, not a dot. The
 * local fork layers on the compact rail variant, shared-session badge, forest
 * companion and skin hooks. Used by the session list and by rich-composer
 * mention chip tooltips.
 */
export function SessionRowSummary(props: {
    session: SessionSummary
    /** Compact rows used by the collapsed session index rail. */
    compact?: boolean
    showPath?: boolean
    showDetailedStatus?: boolean
    selected?: boolean
    /**
     * When false, attention has no nested HoverTooltip.
     * Use false inside an already-open chip tooltip portal.
     */
    nestedTooltips?: boolean
    /** Pass from parent when the parent owns `aria-describedby` (session list). */
    attentionTooltipId?: string
    scheduleTooltipId?: string
    className?: string
    /** Rows inside the pinned "in progress" section skip the pending text label. */
    inRunningSection?: boolean
    /** Oldest pending request; clicking its icon opens that request. */
    pendingRequestId?: string
    onPendingRequestClick?: () => void
    /** Short project name shown under the title (pinned "in progress" rows). */
    projectLabel?: string
    /** Machine label shown next to the project name (pinned "in progress" rows). */
    machineLabel?: string
    /** Whether the owner has an active collaborative share for this session. */
    shared?: boolean
    /** Optional list version supplied by session-list tests/virtualized callers. */
    lastSeenVersion?: number
    /** Context returned by the opt-in session message-content search. */
    contentSnippet?: string
    /** The indexed message exceeded the search index budget. */
    contentSearchTruncated?: boolean
    /** Extra classes for the right-hand time/progress cluster (e.g. to yield to hover actions). */
    trailingClassName?: string
}) {
    const {
        session: s,
        compact = false,
        showPath = true,
        showDetailedStatus = true,
        selected = false,
        nestedTooltips = true,
        attentionTooltipId: attentionTooltipIdProp,
        scheduleTooltipId: scheduleTooltipIdProp,
        className,
        inRunningSection = false,
        pendingRequestId,
        onPendingRequestClick,
        projectLabel,
        machineLabel,
        shared = false,
        lastSeenVersion,
        contentSnippet,
        contentSearchTruncated = false,
        trailingClassName,
    } = props
    const { t } = useTranslation()
    const sessionName = getSessionTitle(s)
    const worktreeLabel = getWorktreeSessionLabel(s)
    const todoProgress = getTodoProgress(s)
    const attention = useMemo(
        () => showDetailedStatus
            ? classifySessionAttention(s, {
                selected,
                lastSeenAt: getSessionLastSeenAt(s.id),
                manualUnreadAt: getSessionManualUnreadAt(s.id, s.readState),
            })
            : null,
        [s, selected, showDetailedStatus, lastSeenVersion]
    )
    const attentionLabel = attention ? getAttentionLabel(attention, t) : null
    const urgentAttention = attention !== null
        && (attention.kind === 'permission' || attention.kind === 'input')
    const scheduledLabel = s.futureScheduledMessageCount > 1
        ? t('session.item.scheduledMessages', { count: s.futureScheduledMessageCount })
        : t('session.item.scheduledMessage')
    const hasScheduleTooltip = showDetailedStatus && s.futureScheduledMessageCount > 0
    const ownedIds = useSessionRowTooltipIds(
        Boolean(attention) && nestedTooltips && !attentionTooltipIdProp,
        hasScheduleTooltip && nestedTooltips && !scheduleTooltipIdProp
    )
    const attentionId = attentionTooltipIdProp ?? ownedIds.attentionId
    const scheduleId = scheduleTooltipIdProp ?? ownedIds.scheduleId
    // Rows are memoized, so the label keeps itself current (also advances job elapsed).
    useMinuteTick()
    const nowMs = Date.now()
    const codexSessionId = s.metadata?.flavor === 'codex' ? s.metadata?.agentSessionId : null
    const importedAt = useSyncExternalStore(subscribeCodexImportedSessions, () => getCodexImportedAt(codexSessionId))
    const timeLabel = getSessionTimeLabel(s, importedAt, t)
    const attachedJob = s.attachedJob?.status === 'running' ? s.attachedJob : null
    const jobStale = attachedJob ? isAttachedJobStale(attachedJob, nowMs) : false
    const jobFraction = attachedJob ? attachedJobFraction(attachedJob) : null
    const jobProgressLabel = attachedJob
        ? formatAttachedJobProgress(attachedJob, nowMs, {
            left: t('session.item.attachedJob.left'),
            running: t('session.item.attachedJob.running'),
            noHeartbeat: t('session.item.attachedJob.noHeartbeat'),
        })
        : null

    // Presence lives on the agent icon and every state has its own mark, so no
    // state is shown by the absence of one: solid = working (pulsing), ring =
    // connected and waiting, power mark = stopped or archived. Blue is the
    // existing background-work state. An outliving attached job counts as
    // working even when the agent itself is idle or disconnected.
    // The badge carries *which* state on inspection; the row-level residency
    // fade below carries *which rows* at a glance. Same predicate (!active),
    // two scales — a 10px mark doesn't survive a long-list scan on its own.
    const isRunning = s.active && s.thinking
    const isBackgroundOnly = s.active && !s.thinking && (s.backgroundTaskCount ?? 0) > 0
    const isArchived = s.metadata?.lifecycleState === 'archived'
    const presence: 'working' | 'background' | 'waiting' | 'stopped' = isBackgroundOnly
        ? 'background'
        : isRunning || attachedJob
            ? 'working'
            : s.active
                ? 'waiting'
                : 'stopped'
    // Unread is a semibold title plus accent time — no dot, so the presence
    // badge stays the row's only dot. The label stays for screen readers.
    const isUnread = sessionIsUnread(s, {
        lastSeenAt: getSessionLastSeenAt(s.id),
        manualUnreadAt: getSessionManualUnreadAt(s.id, s.readState),
    })
    const requestKind = urgentAttention
        ? attention.kind as 'permission' | 'input'
        : s.active && (s.pendingRequestsCount ?? 0) > 0
            ? (s.pendingRequestKinds?.length && !s.pendingRequestKinds.includes('permission') ? 'input' : 'permission')
            : null
    // `thinking` is authoritative for foreground activity. A pending input can
    // be blocking or async, and summaries do not distinguish the two, so keep
    // the spinner rather than hiding real work behind the request symbol.
    // Independent background work/jobs still count, even if the agent is
    // disconnected. No work running is not a claim of successful completion:
    // summaries carry no turn-outcome field, and the dot only means unread.
    const hasRunningWork = Boolean(attachedJob)
        || (s.active && (s.backgroundTaskCount ?? 0) > 0)
        || isRunning
    const activityLabel = isBackgroundOnly
        ? t('session.item.background')
        : t('session.item.running')
    const agentIcon = (
        <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
            <AgentFlavorIcon flavor={s.metadata?.flavor} className="h-6 w-6" />
            <span
                data-testid="session-presence"
                data-presence={presence}
                className={`absolute -bottom-0.5 -right-0.5 box-border flex h-2.5 w-2.5 items-center justify-center rounded-full ring-2 ring-[var(--app-bg)] ${PRESENCE_BADGE_CLASS[presence]}`}
            >
                {presence === 'stopped' ? <StoppedBadgeIcon className="h-2.5 w-2.5" /> : null}
            </span>
        </span>
    )
    const compactAgentIcon = (
        <AgentFlavorIcon flavor={s.metadata?.flavor} className="h-3.5 w-3.5 shrink-0 -translate-y-px" />
    )

    return (
        <div className={`hapi-session-summary flex w-full min-w-0 flex-col ${compact ? 'gap-0' : 'gap-1'} ${isArchived ? 'session-row-archived' : ''} ${className ?? ''}`}>
            <div className={`hapi-session-summary__main grid min-w-0 items-center ${compact ? 'grid-cols-[minmax(0,1fr)] gap-1' : 'grid-cols-[minmax(9rem,1fr)_minmax(0,max-content)] gap-2'}`}>
                <div className={`hapi-session-summary__title-row flex min-w-0 items-center ${compact ? 'gap-1' : 'gap-2'}`}>
                    <SessionForestCompanion session={s} compact={compact} />
                    {compact ? (
                        <>
                            {attention?.kind === 'background' && nestedTooltips && attentionId ? (
                                <SessionAttentionIndicator
                                    attention={attention}
                                    summary={s}
                                    label={attentionLabel ?? ''}
                                    tooltipId={attentionId}
                                    target={compactAgentIcon}
                                />
                            ) : compactAgentIcon}
                        </>
                    ) : attention?.kind === 'background' && nestedTooltips && attentionId ? (
                        <SessionAttentionIndicator
                            attention={attention}
                            summary={s}
                            label={attentionLabel ?? ''}
                            tooltipId={attentionId}
                            target={agentIcon}
                        />
                    ) : agentIcon}
                    <div
                        className={`hapi-session-summary__title min-w-0 flex-1 truncate ${compact ? 'text-xs' : 'text-sm'} text-[var(--app-fg)] ${isUnread ? 'font-semibold' : 'font-normal'} ${!s.active ? 'opacity-50' : ''}`}
                        title={sessionName}
                    >
                        {sessionName}
                    </div>
                    {isUnread ? (
                        <span id={nestedTooltips ? attentionId : undefined} className="sr-only">
                            {attentionLabel}
                        </span>
                    ) : null}
                    {shared ? (
                        <span
                            className={`shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 ${compact ? 'px-1 text-[9px]' : ''}`}
                            title={t('sessionShare.active')}
                            aria-label={t('sessionShare.active')}
                        >
                            {compact ? '↗' : t('sessionShare.activeShort')}
                        </span>
                    ) : null}
                    {requestKind && urgentAttention && nestedTooltips && attentionId ? (
                        <SessionAttentionIndicator
                            attention={attention}
                            summary={s}
                            label={attentionLabel ?? ''}
                            tooltipId={attentionId}
                            pendingRequestId={pendingRequestId}
                        />
                    ) : requestKind ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[var(--app-badge-warning-text)]">
                            <SessionRequestIcon
                                kind={requestKind}
                                label={attentionLabel ?? t('session.item.pending')}
                                requestId={pendingRequestId}
                                onClick={(event) => {
                                    if (!onPendingRequestClick) return
                                    event.stopPropagation()
                                    onPendingRequestClick()
                                }}
                            />
                            {!urgentAttention && !inRunningSection ? (
                                <span className="text-[11px] font-medium leading-none">{t('session.item.pending')}</span>
                            ) : null}
                        </span>
                    ) : null}
                    {!compact && hasScheduleTooltip && nestedTooltips && scheduleId ? (
                        <HoverTooltip
                            id={scheduleId}
                            target={<ScheduleIcon className="h-3.5 w-3.5 text-[var(--app-hint)]" />}
                            side="bottom"
                            align="start"
                            className="shrink-0"
                            revealOnParentFocusClass={SESSION_ROW_TOOLTIP_FOCUS_CLASS}
                        >
                            <span className="block">
                                <span className="block font-medium">{scheduledLabel}</span>
                                <span className="mt-1 block text-[var(--app-hint)]">
                                    {formatScheduledTooltipDetail(s, t)}
                                </span>
                            </span>
                        </HoverTooltip>
                    ) : !compact && hasScheduleTooltip ? (
                        <span className="shrink-0" aria-label={scheduledLabel} title={scheduledLabel}>
                            <ScheduleIcon className="h-3.5 w-3.5 text-[var(--app-hint)]" />
                        </span>
                    ) : null}
                    {compact && (isRunning || isBackgroundOnly) ? (
                        <span data-testid="session-row-running" className="ml-auto shrink-0">
                            <Spinner size="sm" label={null} className="h-3.5 w-3.5" />
                        </span>
                    ) : null}
                </div>
                {!compact ? (
                    <div className={`hapi-session-summary__meta flex min-w-0 items-center justify-end gap-2 overflow-hidden text-xs ${trailingClassName ?? ''}`}>
                        {todoProgress ? (
                            <span className="flex shrink-0 items-center gap-1 text-[var(--app-hint)]">
                                <BulbIcon className="h-3 w-3" />
                                {todoProgress.completed}/{todoProgress.total}
                            </span>
                        ) : null}
                        {!attention && s.active && s.pendingRequestsCount > 0 ? (
                            <span className="shrink-0 text-[var(--app-badge-warning-text)]">
                                {t('session.item.pending')} {s.pendingRequestsCount}
                            </span>
                        ) : null}
                        {isRunning || isBackgroundOnly ? (
                            <span data-testid="session-row-running" className="shrink-0">
                                <Spinner size="sm" label={null} className="h-3.5 w-3.5" />
                            </span>
                        ) : null}
                        {timeLabel ? (
                            <span className={`min-w-0 truncate whitespace-nowrap tabular-nums ${
                                isUnread ? 'font-semibold text-[var(--app-link)]' : 'text-[var(--app-hint)]'
                            }`}>{timeLabel}</span>
                        ) : null}
                    </div>
                ) : null}
            </div>
            {attachedJob && jobProgressLabel ? (
                    <div
                        className={`flex min-w-0 items-center gap-2 text-[11px] leading-none ${
                            jobStale
                                ? 'text-[var(--app-badge-warning-text)]'
                                : 'text-[var(--app-badge-success-text)]'
                        }`}
                        title={
                            jobStale
                                ? t('session.item.attachedJob.staleTitle', {
                                    detail: attachedJob.detail ?? attachedJob.label,
                                })
                                : (attachedJob.detail ?? attachedJob.label)
                        }
                    >
                        <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${jobStale ? '' : 'animate-pulse'}`}
                            aria-hidden="true"
                        />
                        {/* The label gives way first: progress, elapsed time and the stale
                            marker are the parts that change, so a long label must not hide them.
                            The label starts at zero and grows into what the status leaves free
                            (up to its full width); the status truncates only once the label is at its minimum. */}
                        <span className="flex min-w-0 items-center gap-1">
                            <span className="min-w-8 max-w-max flex-1 truncate font-medium">
                                {attachedJob.label}
                            </span>
                            <span data-testid="attached-job-status" className="min-w-0 truncate">
                                {jobStale ? (
                                    <span className="font-semibold">· {t('session.item.attachedJob.stale')}</span>
                                ) : null}
                                <span className="font-normal opacity-80">{jobStale ? ' · ' : '· '}{jobProgressLabel}</span>
                            </span>
                        </span>
                        {jobFraction !== null ? (
                            <span
                                data-testid="attached-job-progress-bar"
                                data-progress="determinate"
                                className="ml-auto h-1 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--app-border)]"
                                role="progressbar"
                                aria-label={attachedJob.label}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(jobFraction * 100)}
                            >
                                <span
                                    className="block h-full rounded-full bg-current transition-[width] duration-300"
                                    style={{ width: `${Math.round(jobFraction * 100)}%` }}
                                />
                            </span>
                        ) : (
                            <span
                                data-testid="attached-job-progress-bar"
                                data-progress="indeterminate"
                                className="relative ml-auto h-1 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--app-border)]"
                                role="progressbar"
                                aria-label={attachedJob.label}
                            >
                                {/* No aria-valuenow: unknown amount (ARIA indeterminate). No inline width%. */}
                                <span
                                    className="animate-attached-job-indeterminate"
                                    aria-hidden="true"
                                />
                            </span>
                        )}
                    </div>
                ) : null}
            {!compact && contentSnippet ? (
                <div
                    className="line-clamp-2 text-xs text-[var(--app-fg)]/80"
                    title={contentSearchTruncated
                        ? `${contentSnippet}\n${t('sessions.search.content.truncated')}`
                        : contentSnippet}
                >
                    {contentSnippet}
                    {contentSearchTruncated ? (
                        <span
                            className="ml-1 inline-flex align-[-2px] text-[var(--app-badge-warning-text)]"
                            title={t('sessions.search.content.truncated')}
                            aria-label={t('sessions.search.content.truncated')}
                        >
                            <InfoIcon className="h-3 w-3" />
                        </span>
                    ) : null}
                </div>
            ) : null}
            {!compact && (projectLabel || machineLabel) ? (
                <div className="hapi-session-summary__details truncate text-xs text-[var(--app-hint)]" title={[projectLabel, machineLabel].filter(Boolean).join(' · ')}>
                    {[projectLabel, machineLabel].filter(Boolean).join(' · ')}
                </div>
            ) : !compact && (showPath || worktreeLabel) ? (
                <div
                    className="hapi-session-summary__details truncate text-xs text-[var(--app-hint)]"
                    title={worktreeLabel
                        ? s.metadata?.worktree?.worktreePath ?? s.metadata?.path
                        : undefined}
                >
                    {worktreeLabel ?? s.metadata?.path ?? s.id}
                </div>
            ) : null}
        </div>
    )
}
