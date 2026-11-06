import HapiClient
import HapiProtocol

/// Cross-platform seam for the home-screen widget snapshot writer. The real
/// writer is iOS-only (WidgetKit); Catalyst gets a no-op.
@MainActor
protocol WidgetSnapshotControlling: AnyObject {
    func update(_ sessions: [SessionSummary], hubUrl: String)
    func flush()
    func clear()
}

@MainActor
final class NoopWidgetSnapshotController: WidgetSnapshotControlling {
    func update(_ sessions: [SessionSummary], hubUrl: String) {}
    func flush() {}
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
