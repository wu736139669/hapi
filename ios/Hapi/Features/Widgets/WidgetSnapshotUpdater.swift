#if os(iOS) && !targetEnvironment(macCatalyst)
import Foundation
import HapiClient
import HapiProtocol
import WidgetKit

/// Debounced writer for the App Group widget snapshot. The widget timeline
/// reads this file; the app never talks to WidgetKit for rendering.
@MainActor
final class WidgetSnapshotUpdater: WidgetSnapshotControlling {
    private struct Pending {
        let sessions: [SessionSummary]
        let unreadSessionIds: Set<String>
        let hubUrl: String
    }

    private var pending: Pending?
    private var debounceTask: Task<Void, Never>?
    private let debounce: Duration = .milliseconds(400)
    /// WidgetKit budgets reloads, but a wide 60s window made normal session
    /// changes feel stale. Keep background updates coalesced without making
    /// the widget visibly lag behind the app.
    private let minimumReloadInterval: TimeInterval = 15
    private var lastReloadAt: Date?
    private var delayedReload: Task<Void, Never>?

    func update(_ sessions: [SessionSummary], unreadSessionIds: Set<String>, hubUrl: String) {
        pending = Pending(sessions: sessions, unreadSessionIds: unreadSessionIds, hubUrl: hubUrl)
        debounceTask?.cancel()
        debounceTask = Task { [debounce] in
            do {
                try await Task.sleep(for: debounce)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            self.flush()
        }
    }

    /// Writes any pending snapshot now (app background) and reloads the
    /// widget timelines after the atomic write completes.
    func flush() {
        debounceTask?.cancel()
        debounceTask = nil
        guard let pending else { return }
        self.pending = nil
        let snapshot = WidgetSnapshotBuilder.build(
            sessions: pending.sessions,
            hubUrl: pending.hubUrl,
            unreadSessionIds: pending.unreadSessionIds
        )
        Task { await save(snapshot) }
    }

    func flushAndWait() async {
        debounceTask?.cancel()
        debounceTask = nil
        guard let pending else { return }
        self.pending = nil
        let snapshot = WidgetSnapshotBuilder.build(
            sessions: pending.sessions,
            hubUrl: pending.hubUrl,
            unreadSessionIds: pending.unreadSessionIds
        )
        await save(snapshot)
    }

    func reloadNow() {
        scheduleReload(force: true)
    }

    func clear() {
        debounceTask?.cancel()
        debounceTask = nil
        pending = nil
        Task {
            await Task.detached(priority: .utility) {
                try? WidgetSnapshotStore.save(.empty)
            }.value
            scheduleReload(force: true)
        }
    }

    private func save(_ snapshot: WidgetSnapshot) async {
        await Task.detached(priority: .utility) {
            try? WidgetSnapshotStore.save(snapshot)
        }.value
        scheduleReload()
    }

    private func scheduleReload(force: Bool = false) {
        let now = Date()
        let elapsed = lastReloadAt.map { now.timeIntervalSince($0) } ?? minimumReloadInterval
        if force || elapsed >= minimumReloadInterval {
            delayedReload?.cancel()
            delayedReload = nil
            lastReloadAt = now
            reloadInstalledWidgets(force: force)
            return
        }
        guard delayedReload == nil else { return }
        let waitMs = Int(max(0, minimumReloadInterval - elapsed) * 1000)
        delayedReload = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(waitMs))
            guard !Task.isCancelled, let self else { return }
            self.delayedReload = nil
            self.lastReloadAt = Date()
            self.reloadInstalledWidgets()
        }
    }

    /// Only reload the widget kinds that are actually on the Home/Lock
    /// Screen. Reloading all four kinds on every snapshot update used up the
    /// WidgetKit budget and made background redraws stop entirely.
    private func reloadInstalledWidgets(force: Bool = false) {
        if force {
            for kind in WidgetSnapshotStore.homeWidgetKinds {
                WidgetCenter.shared.reloadTimelines(ofKind: kind)
            }
            return
        }
        WidgetCenter.shared.getCurrentConfigurations { result in
            let kinds: [String]
            switch result {
            case .success(let infos):
                let installed = Array(Set(infos.map(\.kind)))
                    .filter { WidgetSnapshotStore.homeWidgetKinds.contains($0) }
                // getCurrentConfigurations can transiently return an empty
                // array in the background. Falling back keeps the refresh
                // alive instead of silently skipping the reload.
                kinds = installed.isEmpty ? WidgetSnapshotStore.homeWidgetKinds : installed
            case .failure:
                kinds = WidgetSnapshotStore.homeWidgetKinds
            }
            Task { @MainActor in
                for kind in kinds {
                    WidgetCenter.shared.reloadTimelines(ofKind: kind)
                }
            }
        }
    }
}
#endif
