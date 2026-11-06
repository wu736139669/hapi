import HapiClient
import HapiProtocol
import XCTest
@testable import Hapi

@MainActor
final class SessionListGroupingPresentationTests: XCTestCase {
    private func makeModel(
        _ summaries: [SessionSummary],
        pins pinnedIds: [String] = []
    ) throws -> (SessionListModel, PersonalPinStore, String) {
        let suite = "SessionListGroupingPresentation-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let store = PersonalPinStore(defaults: defaults)
        for id in pinnedIds { store.toggle(id) }
        let sessions = HomeFilterTestSessions(summaries)
        let model = SessionListModel(
            sessionStore: sessions,
            machineStore: HomeFilterTestMachines(),
            lastSeenStore: LastSeenStore(),
            personalPins: store,
            hubUrl: "test"
        )
        return (model, store, suite)
    }

    func testSectionsFollowH5OrderBucketsAndPersonalPins() async throws {
        var personal = HomeFilterTestData.summary("personal", machine: "mac")
        personal.thinking = true
        personal.metadata?.path = "/repo/a"

        var global = HomeFilterTestData.summary("global", machine: "mac")
        global.globalPinned = true
        global.metadata?.path = "/repo/g"

        var working = HomeFilterTestData.summary("working", machine: "mac")
        working.thinking = true
        working.metadata?.path = "/repo/w"

        var pending = HomeFilterTestData.summary("pending", machine: "mac")
        pending.pendingRequestsCount = 1
        pending.pendingRequestKinds = [.input]
        pending.metadata?.path = "/repo/p"

        var idle = HomeFilterTestData.summary("idle", machine: "mac")
        idle.thinking = false
        idle.metadata?.lifecycleState = "idle"
        idle.metadata?.path = "/repo/i"

        var active = HomeFilterTestData.summary("active", machine: "mac")
        active.thinking = false
        active.metadata?.path = "/repo/active"

        var project = HomeFilterTestData.summary("project", machine: "mac")
        project.pinned = true
        project.thinking = true
        project.metadata?.path = "/repo/a"

        var inactive = HomeFilterTestData.summary("inactive", machine: "mac")
        inactive.active = false
        inactive.thinking = false
        inactive.metadata?.path = "/repo/b"

        let (model, pins, suite) = try makeModel(
            [personal, global, working, pending, idle, active, project, inactive],
            pins: ["personal"]
        )
        defer { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        await model.refresh()

        let sections = model.sections
        XCTAssertEqual(sections.map(\.kind), [
            .personalPinned, .globalPinned, .inProgress, .active, .directory, .directory,
        ])
        XCTAssertEqual(sections[0].rows.map(\.id), ["personal"])
        XCTAssertEqual(sections[1].rows.map(\.id), ["global"])

        let inProgress = sections[2]
        XCTAssertEqual(inProgress.buckets.map(\.bucket), [.working, .pending])
        XCTAssertEqual(inProgress.buckets[0].rows.map(\.id), ["working"])
        XCTAssertEqual(inProgress.buckets[1].rows.map(\.id), ["pending"])

        let activeSection = sections[3]
        XCTAssertEqual(activeSection.buckets.map(\.bucket), [.active, .idle])
        XCTAssertEqual(activeSection.buckets[0].rows.map(\.id), ["active"])
        XCTAssertEqual(activeSection.buckets[1].rows.map(\.id), ["idle"])

        let projectGroup = sections[4]
        XCTAssertEqual(projectGroup.rows.map(\.id), ["project"])
        XCTAssertFalse(projectGroup.defaultCollapsed)

        let inactiveGroup = sections[5]
        XCTAssertEqual(inactiveGroup.rows.map(\.id), ["inactive"])
        XCTAssertTrue(inactiveGroup.defaultCollapsed)

        XCTAssertTrue(pins.contains("personal"))
        XCTAssertTrue(model.isPersonallyPinned("personal"))
    }

    func testTogglingPersonalPinMovesRowIntoMySessions() async throws {
        let first = HomeFilterTestData.summary("first", machine: "mac")
        let second = HomeFilterTestData.summary("second", machine: "mac")
        let (model, _, suite) = try makeModel([first, second])
        defer { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        await model.refresh()

        XCTAssertNotEqual(model.sections.first?.kind, .personalPinned)
        model.togglePersonalPin(sessionId: "second")
        let sections = model.sections
        XCTAssertEqual(sections.first?.kind, .personalPinned)
        XCTAssertEqual(sections.first?.rows.map(\.id), ["second"])
        XCTAssertTrue(model.isPersonallyPinned("second"))

        model.togglePersonalPin(sessionId: "second")
        XCTAssertFalse(model.isPersonallyPinned("second"))
        XCTAssertNotEqual(model.sections.first?.kind, .personalPinned)
    }
}
