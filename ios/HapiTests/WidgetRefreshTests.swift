import XCTest
@testable import Hapi

@MainActor
final class WidgetRefreshTests: XCTestCase {
    func testSilentPushDetection() {
        XCTAssertTrue(WidgetRefreshScheduler.isSilentPush([
            "aps": ["content-available": 1]
        ]))
        XCTAssertTrue(WidgetRefreshScheduler.isSilentPush([
            "aps": ["content-available": true]
        ]))
        XCTAssertFalse(WidgetRefreshScheduler.isSilentPush([
            "aps": ["alert": ["title": "HAPI"]]
        ]))
        XCTAssertFalse(WidgetRefreshScheduler.isSilentPush([:]))
    }

    func testBridgeForwardsTheInstalledRefresh() async {
        let bridge = WidgetRefreshBridge()
        let missing = await bridge.refresh()
        XCTAssertFalse(missing)

        var calls = 0
        bridge.install {
            calls += 1
            return true
        }
        let refreshed = await bridge.refresh()
        XCTAssertTrue(refreshed)
        XCTAssertEqual(calls, 1)
    }
}
