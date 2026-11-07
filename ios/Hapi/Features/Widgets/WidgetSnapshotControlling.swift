import HapiClient
import HapiProtocol

/// Cross-platform seam for the home-screen widget snapshot writer. The real
/// writer is iOS-only (WidgetKit); Catalyst gets a no-op.
@MainActor
protocol WidgetSnapshotControlling: AnyObject {
    func update(_ sessions: [SessionSummary], unreadSessionIds: Set<String>, hubUrl: String)
    func flush()
    /// Background tasks must wait for the App Group write before they report
    /// completion; iOS may suspend the process immediately afterwards.
    func flushAndWait() async
    /// Force a WidgetKit reload after a foreground flush; background writes
    /// are deliberately throttled to stay inside the system reload budget.
    func reloadNow()
    func clear()
}

@MainActor
final class NoopWidgetSnapshotController: WidgetSnapshotControlling {
    func update(_ sessions: [SessionSummary], unreadSessionIds: Set<String>, hubUrl: String) {}
    func flush() {}
    func flushAndWait() async {}
    func reloadNow() {}
    func clear() {}
}

enum WidgetSnapshotControllerFactory {
    @MainActor
    static func make() -> any WidgetSnapshotControlling {
        #if os(iOS) && !targetEnvironment(macCatalyst)
        return WidgetSnapshotUpdater()
        #else
        return NoopWidgetSnapshotController()
        #endif
    }
}
