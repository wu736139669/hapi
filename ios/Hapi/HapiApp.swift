import HapiProtocol
import OSLog
import SwiftUI

@main
struct HapiApp: App {
    /// APNs registration callbacks + notification-center delegate install
    /// (P3) — SwiftUI lifecycle apps get them only through the adaptor.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    private let log = Logger(subsystem: "run.hapi.companion", category: "app")

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .onOpenURL { url in
                    handleIncomingURL(url)
                }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            model.handleScenePhase(phase)
        }
        .commands {
            HapiCommands()
        }
    }

    /// `hapicompanion://bind?hub=<url>&code=<accessToken>` — parse and route
    /// through `AppModel`: unpaired → pairing confirm; already paired to that
    /// hub → switch with a notice; a different hub → add-hub confirm.
    ///
    /// Live Activities open `hapicompanion://sessions/<id>[?hub=<url>]`;
    /// that form is routed through the same notification-target path.
    ///
    /// Never log the URL itself: the bind query carries the access token.
    private func handleIncomingURL(_ url: URL) {
        if let link = BindLink.parse(url.absoluteString) {
            if !model.handleBindLink(link) {
                log.warning("Bind link carried an unusable hub URL")
            }
            return
        }
        if let link = SessionLink.parse(url.absoluteString) {
            model.handleSessionLink(link)
            return
        }
        log.warning("Ignoring malformed URL (scheme: \(url.scheme ?? "none", privacy: .public))")
    }
}
