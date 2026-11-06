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
        let hubUrl: String
    }

    private var pending: Pending?
    private var debounceTask: Task<Void, Never>?
    private let debounce: Duration = .milliseconds(400)

    func update(_ sessions: [SessionSummary], hubUrl: String) {
        pending = Pending(sessions: sessions, hubUrl: hubUrl)
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
            hubUrl: pending.hubUrl
        )
        Task.detached(priority: .utility) {
            try? WidgetSnapshotStore.save(snapshot)
            await MainActor.run {
                WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshotStore.widgetKind)
            }
        }
    }

    func clear() {
        debounceTask?.cancel()
        debounceTask = nil
        pending = nil
        Task.detached(priority: .utility) {
            try? WidgetSnapshotStore.save(.empty)
            await MainActor.run {
                WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshotStore.widgetKind)
            }
        }
    }
}
#endif
