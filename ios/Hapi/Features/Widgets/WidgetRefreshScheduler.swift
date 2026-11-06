import BackgroundTasks
import Foundation
import OSLog

/// Registers the periodic widget refresh and the silent-push wake-up path.
/// iOS suspends the app after backgrounding; these are the only entry points
/// that let it rewrite the App Group snapshot without the user opening it.
@MainActor
enum WidgetRefreshScheduler {
    static let taskIdentifier = "run.hapi.companion.widget-refresh"
    private static let log = Logger(subsystem: "run.hapi.companion", category: "widget-refresh")
    private static var registered = false

    static func register() {
        guard !registered else { return }
        registered = true
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            Task { @MainActor in
                handle(task)
            }
        }
    }

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            log.debug("BGAppRefreshTask submit failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private static func handle(_ task: BGTask) {
        // Always keep a next request queued; iOS decides when it runs.
        schedule()
        guard let refresh = task as? BGAppRefreshTask else {
            task.setTaskCompleted(success: false)
            return
        }
        let work = Task { @MainActor in
            let ok = await WidgetRefreshBridge.shared.refresh()
            refresh.setTaskCompleted(success: ok)
        }
        refresh.expirationHandler = {
            work.cancel()
        }
    }

    /// A background APNs payload has no alert and `content-available: 1`.
    nonisolated static func isSilentPush(_ userInfo: [AnyHashable: Any]) -> Bool {
        guard let aps = userInfo["aps"] as? [String: Any] else { return false }
        if let value = aps["content-available"] as? Int {
            return value == 1
        }
        if let value = aps["content-available"] as? Bool {
            return value
        }
        return false
    }
}

/// The app delegate and the background task need the active model. AppModel
/// installs this closure; the delegate never holds the model directly.
@MainActor
final class WidgetRefreshBridge {
    static let shared = WidgetRefreshBridge()

    private var handler: (@MainActor () async -> Bool)?

    func install(_ handler: @escaping @MainActor () async -> Bool) {
        self.handler = handler
    }

    func refresh() async -> Bool {
        guard let handler else { return false }
        return await handler()
    }
}
