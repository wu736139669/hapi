#if os(iOS) && !targetEnvironment(macCatalyst)
import ActivityKit
import Foundation
import HapiClient
import HapiProtocol
import OSLog

/// Owns every HAPI Live Activity on this device.
///
/// The app creates activities locally (push-to-start cannot be updated until
/// the app runs and provides the per-activity token), registers each
/// activity's APNs token with the active hub, and keeps local state fresh
/// while it runs. When suspended/killed, the hub's encrypted `liveactivity`
/// pushes take over; on the next launch `Activity.activities` recovers the
/// surviving activities and re-registers their tokens.
@MainActor
final class LiveActivityCoordinator: LiveActivityControlling {
    let prefs: LiveActivityPrefs

    private weak var hub: HubSession?
    private var activities: [String: Activity<SessionActivityAttributes>] = [:]
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private var stateTasks: [String: Task<Void, Never>] = [:]
    private var registeredTokens: [String: String] = [:]
    private var startedAt: [String: Int] = [:]
    private var lastUserMessageAt: [String: Int] = [:]
    private var lastStateKeys: [String: String] = [:]
    /// False once the hub reports it cannot push Live Activity updates
    /// (relay/off mode); the local activity must then end on background
    /// instead of looking frozen on the Lock Screen.
    private var remoteSupported = true

    /// System limit is undocumented; keep the lock screen legible and let
    /// attention states win when more sessions are running.
    private let maxActivities = 5
    private let log = Logger(subsystem: "run.hapi.companion", category: "live-activity")

    init(prefs: LiveActivityPrefs) {
        self.prefs = prefs
    }

    // MARK: - Hub lifecycle

    func attach(to hub: HubSession) {
        self.hub = hub
        remoteSupported = true
        guard prefs.enabled, ActivityAuthorizationInfo().areActivitiesEnabled else {
            endRecoveredActivities()
            return
        }
        recoverActivities()
        sessionsChanged(hub.sessionStore.sessions)
    }

    func detach() {
        endAll(policy: .immediate)
        hub = nil
        remoteSupported = true
    }

    func appDidBecomeActive() {
        guard prefs.enabled, let hub else { return }
        remoteSupported = true
        for (sessionId, activity) in activities {
            if let token = activity.pushToken {
                registerToken(token, sessionId: sessionId, force: true)
            }
        }
        sessionsChanged(hub.sessionStore.sessions)
    }

    func appDidBackground() {
        // APNs is the only reliable background updater. Without it, a frozen
        // lock-screen card is worse than no card.
        guard !remoteSupported else { return }
        endAll(policy: .immediate)
    }

    func setEnabled(_ enabled: Bool) {
        prefs.setEnabled(enabled)
        if enabled {
            guard let hub else { return }
            sessionsChanged(hub.sessionStore.sessions)
        } else {
            endAll(policy: .immediate)
        }
    }

    // MARK: - Reconciliation

    func sessionsChanged(_ sessions: [SessionSummary]) {
        guard prefs.enabled, hub != nil else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        guard PushKeychain.ensurePushKey() != nil else { return }

        let tracked = sessions.filter { summary in
            LiveActivityPolicy.isTracked(
                active: summary.active,
                thinking: summary.thinking,
                pendingRequestsCount: summary.pendingRequestsCount
            )
        }
        let selected = select(tracked)
        let selectedIds = Set(selected.map(\.id))

        for (sessionId, activity) in activities where !selectedIds.contains(sessionId) {
            let summary = sessions.first { $0.id == sessionId }
            if let summary, !LiveActivityPolicy.isTracked(
                active: summary.active,
                thinking: summary.thinking,
                pendingRequestsCount: summary.pendingRequestsCount
            ) {
                endActivity(
                    activity,
                    sessionId: sessionId,
                    finalState: finalState(for: summary, status: .done),
                    policy: .after(Date().addingTimeInterval(60)),
                    unregister: true
                )
            } else {
                // Over the local cap while still running: remove quietly; the
                // hub's token row is cleaned up by the unregister call.
                endActivity(activity, sessionId: sessionId, finalState: nil, policy: .immediate, unregister: true)
            }
        }

        for summary in selected {
            reconcile(summary)
        }
    }

    private func reconcile(_ summary: SessionSummary) {
        guard let hub, let key = PushKeychain.ensurePushKey() else { return }
        let now = Self.nowMillis()
        guard let status = LiveActivityPolicy.status(
            active: summary.active,
            thinking: summary.thinking,
            pendingRequestsCount: summary.pendingRequestsCount,
            pendingRequestKinds: Set(summary.pendingRequestKinds)
        ) else {
            if let activity = activities[summary.id] {
                endActivity(
                    activity,
                    sessionId: summary.id,
                    finalState: finalState(for: summary, status: .done),
                    policy: .after(Date().addingTimeInterval(60)),
                    unregister: true
                )
            }
            return
        }

        let state = LiveActivityContentState(
            status: status,
            title: SessionListSearch.sessionTitle(summary),
            project: projectName(summary),
            startedAt: turnStart(for: summary, now: now),
            updatedAt: now,
            pendingCount: summary.pendingRequestsCount,
            todoCompleted: summary.todoProgress?.completed ?? 0,
            todoTotal: summary.todoProgress?.total ?? 0,
            backgroundTaskCount: summary.backgroundTaskCount
        )
        let stateKey = Self.stateKey(state)
        guard let encrypted = try? LiveActivityCipher.seal(state, key: key.data) else {
            log.error("Could not encrypt Live Activity state")
            return
        }
        let content = ActivityContent(
            state: encrypted,
            staleDate: Date().addingTimeInterval(120)
        )

        if let activity = activities[summary.id] {
            guard lastStateKeys[summary.id] != stateKey else { return }
            lastStateKeys[summary.id] = stateKey
            Task {
                await activity.update(content)
            }
            return
        }

        let attributes = SessionActivityAttributes(sessionId: summary.id, hubUrl: hub.hubUrl)
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: .token
            )
            lastStateKeys[summary.id] = stateKey
            activities[summary.id] = activity
            observe(activity)
        } catch let error as ActivityAuthorizationError {
            if error == .targetMaximumExceeded {
                log.error("ActivityKit target limit exceeded; trimming the lowest-priority activity")
                trimForCapacity()
            } else {
                log.error("Activity.request failed: \(String(describing: error), privacy: .public)")
            }
        } catch {
            log.error("Activity.request failed: \(String(describing: error), privacy: .public)")
        }
    }

    private func select(_ tracked: [SessionSummary]) -> [SessionSummary] {
        tracked.sorted { lhs, rhs in
            let lhsPriority = attentionPriority(lhs)
            let rhsPriority = attentionPriority(rhs)
            if lhsPriority != rhsPriority { return lhsPriority > rhsPriority }
            return (lhs.lastUserMessageAt ?? lhs.updatedAt) > (rhs.lastUserMessageAt ?? rhs.updatedAt)
        }
        .prefix(maxActivities)
        .map { $0 }
    }

    private func attentionPriority(_ summary: SessionSummary) -> Int {
        guard summary.pendingRequestsCount > 0 else { return 2 }
        let kinds = Set(summary.pendingRequestKinds)
        if kinds == [.input] { return 3 }
        if kinds == [.permission] { return 4 }
        return 5
    }

    /// `targetMaximumExceeded`: drop the lowest-priority current activity so
    /// the next reconcile can start the one that just failed.
    private func trimForCapacity() {
        guard let hub else { return }
        let ranked = activities.keys.sorted { lhs, rhs in
            let lhsSummary = hub.sessionStore.sessions.first { $0.id == lhs }
            let rhsSummary = hub.sessionStore.sessions.first { $0.id == rhs }
            let lhsPriority = lhsSummary.map { attentionPriority($0) } ?? 0
            let rhsPriority = rhsSummary.map { attentionPriority($0) } ?? 0
            return lhsPriority < rhsPriority
        }
        guard let victim = ranked.first, let activity = activities[victim] else { return }
        endActivity(activity, sessionId: victim, finalState: nil, policy: .immediate, unregister: true)
    }

    private func turnStart(for summary: SessionSummary, now: Int) -> Int {
        let lastUser = summary.lastUserMessageAt
        if let lastUser, lastUserMessageAt[summary.id] != lastUser {
            lastUserMessageAt[summary.id] = lastUser
            startedAt[summary.id] = lastUser
            return lastUser
        }
        if let existing = startedAt[summary.id], existing > 0 { return existing }
        let start = lastUser ?? now
        startedAt[summary.id] = start
        return start
    }

    private func projectName(_ summary: SessionSummary) -> String {
        guard let path = summary.metadata?.path else { return "" }
        return path.split(separator: "/").last.map(String.init) ?? ""
    }

    private func finalState(
        for summary: SessionSummary,
        status: LiveActivityContentState.Status
    ) -> LiveActivityContentState {
        LiveActivityContentState(
            status: status,
            title: SessionListSearch.sessionTitle(summary),
            project: projectName(summary),
            startedAt: turnStart(for: summary, now: Self.nowMillis()),
            updatedAt: Self.nowMillis(),
            pendingCount: summary.pendingRequestsCount,
            todoCompleted: summary.todoProgress?.completed ?? 0,
            todoTotal: summary.todoProgress?.total ?? 0,
            backgroundTaskCount: summary.backgroundTaskCount
        )
    }

    // MARK: - Activity + token lifecycle

    private func observe(_ activity: Activity<SessionActivityAttributes>) {
        let sessionId = activity.attributes.sessionId

        if let token = activity.pushToken {
            registerToken(token, sessionId: sessionId, force: false)
        }
        tokenTasks[sessionId]?.cancel()
        tokenTasks[sessionId] = Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                guard let self else { return }
                // A newer activity for the same session owns the registration
                // now; do not let a stale token stream overwrite its token.
                guard self.activities[sessionId]?.id == activity.id else { return }
                self.registerToken(token, sessionId: sessionId, force: false)
            }
        }
        stateTasks[sessionId]?.cancel()
        stateTasks[sessionId] = Task { [weak self] in
            for await state in activity.activityStateUpdates {
                guard let self else { return }
                if state == .ended || state == .dismissed {
                    guard self.activities[sessionId]?.id == activity.id else { return }
                    self.unregisterToken(sessionId: sessionId)
                    self.forget(sessionId)
                    return
                }
            }
        }
    }

    private func registerToken(_ token: Data, sessionId: String, force: Bool) {
        guard let hub, let key = PushKeychain.ensurePushKey() else { return }
        let hex = token.map { String(format: "%02x", $0) }.joined()
        if !force, registeredTokens[sessionId] == hex { return }
        registeredTokens[sessionId] = hex
        let api = hub.api
        let deviceId = PushKeychain.ensureDeviceId()
        let pushKey = key.base64
        Task {
            do {
                let response = try await api.registerLiveActivityToken(
                    token: hex,
                    deviceId: deviceId,
                    sessionId: sessionId,
                    pushKey: pushKey
                )
                remoteSupported = response.remote
                if !response.remote {
                    log.info("Hub does not support remote Live Activity updates; will end on background")
                }
            } catch {
                log.error("Live Activity token registration failed: \(String(describing: error), privacy: .public)")
            }
        }
    }

    private func unregisterToken(sessionId: String) {
        guard let hub, let token = registeredTokens.removeValue(forKey: sessionId) else { return }
        let api = hub.api
        Task {
            try? await api.unregisterLiveActivityToken(token: token)
        }
    }

    private func endActivity(
        _ activity: Activity<SessionActivityAttributes>,
        sessionId: String,
        finalState: LiveActivityContentState?,
        policy: ActivityUIDismissalPolicy,
        unregister: Bool
    ) {
        let api = hub?.api
        let token = registeredTokens[sessionId]
        let key = PushKeychain.ensurePushKey()
        forget(sessionId)
        Task {
            if let finalState,
               let key,
               let encrypted = try? LiveActivityCipher.seal(finalState, key: key.data) {
                await activity.end(
                    ActivityContent(state: encrypted, staleDate: nil),
                    dismissalPolicy: policy
                )
            } else {
                await activity.end(nil, dismissalPolicy: policy)
            }
            // Unregister only the token this activity owned. Deleting by
            // device/session could race a new turn's fresh registration.
            guard unregister, let api, let token else { return }
            try? await api.unregisterLiveActivityToken(token: token)
        }
    }

    private func endAll(policy: ActivityUIDismissalPolicy) {
        let snapshot = activities
        activities.removeAll()
        for (sessionId, activity) in snapshot {
            endActivity(activity, sessionId: sessionId, finalState: nil, policy: policy, unregister: true)
        }
        for task in tokenTasks.values { task.cancel() }
        for task in stateTasks.values { task.cancel() }
        tokenTasks.removeAll()
        stateTasks.removeAll()
        registeredTokens.removeAll()
        startedAt.removeAll()
        lastUserMessageAt.removeAll()
        lastStateKeys.removeAll()
    }

    private func forget(_ sessionId: String) {
        activities.removeValue(forKey: sessionId)
        tokenTasks.removeValue(forKey: sessionId)?.cancel()
        stateTasks.removeValue(forKey: sessionId)?.cancel()
        registeredTokens.removeValue(forKey: sessionId)
        startedAt.removeValue(forKey: sessionId)
        lastUserMessageAt.removeValue(forKey: sessionId)
        lastStateKeys.removeValue(forKey: sessionId)
    }

    private func recoverActivities() {
        guard let hub else { return }
        let key = PushKeychain.ensurePushKey()
        for activity in Activity<SessionActivityAttributes>.activities {
            let sessionId = activity.attributes.sessionId
            guard activity.attributes.hubUrl == hub.hubUrl,
                  activity.activityState == .active || activity.activityState == .stale else {
                Task { await activity.end(nil, dismissalPolicy: .immediate) }
                continue
            }
            activities[sessionId] = activity
            if let key,
               let state = try? LiveActivityCipher.open(activity.content.state, key: key.data) {
                startedAt[sessionId] = state.startedAt
                lastStateKeys[sessionId] = Self.stateKey(state)
            }
            observe(activity)
        }
    }

    /// Feature off (or disabled in iOS Settings): clear survivors from a
    /// previous launch so the Lock Screen and Dynamic Island go quiet.
    private func endRecoveredActivities() {
        let existing = Activity<SessionActivityAttributes>.activities
        guard !existing.isEmpty else { return }
        log.info("Live Activities disabled; ending \(existing.count) existing activities")
        let api = hub?.api
        for activity in existing {
            let token = activity.pushToken.map { data in
                data.map { String(format: "%02x", $0) }.joined()
            }
            Task {
                await activity.end(nil, dismissalPolicy: .immediate)
                if let token, let api {
                    try? await api.unregisterLiveActivityToken(token: token)
                }
            }
        }
    }

    private static func nowMillis() -> Int {
        Int(Date().timeIntervalSince1970 * 1000)
    }

    private static func stateKey(_ state: LiveActivityContentState) -> String {
        [
            state.status.rawValue,
            state.title,
            state.project,
            String(state.startedAt),
            String(state.pendingCount),
            String(state.todoCompleted),
            String(state.todoTotal),
            String(state.backgroundTaskCount)
        ].joined(separator: "|")
    }
}
#endif
