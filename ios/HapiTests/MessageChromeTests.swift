import HapiProtocol
import XCTest
@testable import Hapi

final class MessageChromeTests: XCTestCase {
    func testDurationLabels() {
        XCTAssertEqual(ChatDurationLabel.text(ms: 500), "0.5s")
        XCTAssertEqual(ChatDurationLabel.text(ms: 8_500), "8.5s")
        XCTAssertEqual(ChatDurationLabel.text(ms: 65_000), "1m 5s")
        XCTAssertNil(ChatDurationLabel.text(ms: 0))
    }

    func testMessageMetadataUsesUsage() {
        let meta = ChatMessageMeta(
            durationMs: 8_500,
            model: "claude-sonnet",
            usage: UsageData(inputTokens: 120, outputTokens: 45)
        )

        XCTAssertTrue(meta.hasDetails)
        XCTAssertEqual(meta.durationLabel, "8.5s")
        XCTAssertEqual(meta.model, "claude-sonnet")
        XCTAssertEqual(meta.tokenLabel, "120 / 45")
    }

    func testEmptyMetadataHidesTheInfoAction() {
        XCTAssertFalse(ChatMessageMeta().hasDetails)
        XCTAssertNil(ChatMessageMeta().durationLabel)
        XCTAssertNil(ChatMessageMeta().tokenLabel)
    }
}
