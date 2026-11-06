import HapiClient
import HapiProtocol
import XCTest
@testable import Hapi

/// Live Activity tap-through uses the same notification-target path as a push
/// tap; the hub hint is only honored when it is already paired.
@MainActor
final class LiveActivityRoutingTests: XCTestCase {
    private func makeModel() -> (AppModel, UserDefaults, String) {
        let suiteName = "LiveActivityRoutingTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let model = AppModel(
            registry: HubRegistry(defaults: defaults),
            credentialStore: InMemoryCredentialStore()
        )
        return (model, defaults, suiteName)
    }

    func testSessionLinkSetsPendingOpenSessionId() {
        let (model, defaults, suiteName) = makeModel()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        model.handleSessionLink(SessionLink(
            sessionId: "sess-1",
            hubUrl: "https://hub.example.com"
        ))

        XCTAssertEqual(model.pendingOpenSessionId, "sess-1")
        XCTAssertEqual(model.state, .unpaired)
    }

    func testUnpairedHubHintFallsBackToTheActiveHub() {
        let (model, defaults, suiteName) = makeModel()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        model.handleSessionLink(SessionLink(sessionId: "sess-2", hubUrl: nil))

        XCTAssertEqual(model.pendingOpenSessionId, "sess-2")
    }
}
