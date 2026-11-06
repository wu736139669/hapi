import HapiClient
import HapiProtocol

/// The app-side seam for Live Activities. Declared unconditionally so
/// `AppModel` builds on Mac Catalyst too; the real coordinator is compiled
/// only for iOS (ActivityKit is unavailable on Catalyst).
@MainActor
protocol LiveActivityControlling: AnyObject {
    var prefs: LiveActivityPrefs { get }

    /// The active hub changed (initial build, switch). `detach()` must run
    /// before the old hub is shut down so its activities can end and their
    /// tokens can be unregistered while the API still works.
    func attach(to hub: HubSession)
    func detach()

    func sessionsChanged(_ sessions: [SessionSummary])
    func setEnabled(_ enabled: Bool)
    func appDidBecomeActive()
    func appDidBackground()
}

/// Catalyst / non-iOS placeholder. It still carries the shared prefs so the
/// Settings toggle behaves consistently.
@MainActor
final class NoopLiveActivityController: LiveActivityControlling {
    let prefs: LiveActivityPrefs

    init(prefs: LiveActivityPrefs) {
        self.prefs = prefs
    }

    func attach(to hub: HubSession) {}
    func detach() {}
    func sessionsChanged(_ sessions: [SessionSummary]) {}
    func setEnabled(_ enabled: Bool) { prefs.setEnabled(enabled) }
    func appDidBecomeActive() {}
    func appDidBackground() {}
}

enum LiveActivityControllerFactory {
    @MainActor
    static func make(prefs: LiveActivityPrefs) -> any LiveActivityControlling {
        #if os(iOS) && !targetEnvironment(macCatalyst)
        return LiveActivityCoordinator(prefs: prefs)
        #else
        return NoopLiveActivityController(prefs: prefs)
        #endif
    }
}
