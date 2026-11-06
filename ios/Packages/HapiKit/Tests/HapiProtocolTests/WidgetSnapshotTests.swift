import Foundation
import HapiProtocol
import Testing

@Suite("Widget snapshot")
struct WidgetSnapshotTests {
    private func summary(
        id: String,
        active: Bool = true,
        thinking: Bool = false,
        pending: Int = 0,
        kinds: [PendingRequestKind] = [],
        updatedAt: Int,
        lastUserMessageAt: Int? = nil,
        name: String? = nil,
        path: String = "/Users/me/projects/hapi",
        todo: TodoProgress? = nil,
        backgroundTasks: Int = 0
    ) -> SessionSummary {
        SessionSummary(
            id: id,
            active: active,
            thinking: thinking,
            activeAt: updatedAt,
            updatedAt: updatedAt,
            lastUserMessageAt: lastUserMessageAt,
            metadata: SessionSummaryMetadata(name: name, path: path),
            metadataVersion: 1,
            agentStateVersion: 1,
            todosUpdatedAt: 0,
            todoProgress: todo,
            pendingRequestsCount: pending,
            pendingRequestKinds: kinds,
            backgroundTaskCount: backgroundTasks
        )
    }

    @Test func selectsAttentionFirstAndKeepsExactTotals() {
        let now = 1_700_000_000_000
        let snapshot = WidgetSnapshotBuilder.build(
            sessions: [
                summary(id: "working", thinking: true, updatedAt: now - 30_000, lastUserMessageAt: now - 90_000, name: "Fix widget"),
                summary(id: "approval", pending: 2, kinds: [.permission], updatedAt: now - 20_000, name: "Review Android"),
                summary(id: "input", pending: 1, kinds: [.input], updatedAt: now - 10_000, name: "Answer question"),
                summary(id: "done", thinking: false, updatedAt: now - 5_000, name: "Old done"),
                summary(id: "stale", thinking: false, updatedAt: now - 60 * 60 * 1000, name: "Too old")
            ],
            hubUrl: "https://hub.example.com",
            now: now,
            recentWindowMs: 15 * 60 * 1000,
            limit: 3
        )

        #expect(snapshot.sessions.map(\.id) == ["approval", "input", "working"])
        #expect(snapshot.runningCount == 1)
        #expect(snapshot.needsApprovalCount == 1)
        #expect(snapshot.needsInputCount == 1)
        #expect(snapshot.sessions.first?.startedAt == nil)
        #expect(snapshot.sessions.first?.project == "hapi")
        #expect(snapshot.sessions.first?.title == "Review Android")
        #expect(snapshot.generatedAt == now)
        #expect(snapshot.hubUrl == "https://hub.example.com")
    }

    @Test func includesRecentlyCompletedSessionsWithinTheWindow() {
        let now = 1_700_000_000_000
        let snapshot = WidgetSnapshotBuilder.build(
            sessions: [
                summary(id: "recent", thinking: false, updatedAt: now - 1_000, name: "Recent"),
                summary(id: "old", thinking: false, updatedAt: now - 16 * 60 * 1000, name: "Old")
            ],
            hubUrl: "https://hub.example.com",
            now: now
        )

        #expect(snapshot.sessions.map(\.id) == ["recent"])
        #expect(snapshot.sessions.first?.status == .done)
        #expect(snapshot.runningCount == 0)
    }

    @Test func titleFallsBackThroughTheSameOrderAsTheApp() {
        var item = summary(id: "fallback-id", updatedAt: 1, path: "/repo/My Project")
        #expect(WidgetSnapshotBuilder.title(for: item) == "My Project")

        item.metadata?.promptTitle = "Prompt title"
        #expect(WidgetSnapshotBuilder.title(for: item) == "Prompt title")

        item.metadata?.summary = SessionSummaryMetadata.Summary(text: "Summary title")
        #expect(WidgetSnapshotBuilder.title(for: item) == "Summary title")

        item.metadata?.name = "Manual name"
        #expect(WidgetSnapshotBuilder.title(for: item) == "Manual name")
    }

    @Test func snapshotRoundTripsThroughTheAppGroupFile() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("WidgetSnapshotTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let snapshot = WidgetSnapshotBuilder.build(
            sessions: [summary(id: "s1", thinking: true, updatedAt: 5_000, lastUserMessageAt: 4_000, name: "Session")],
            hubUrl: "https://hub.example.com",
            now: 5_000
        )
        try WidgetSnapshotStore.save(snapshot, to: directory)
        #expect(WidgetSnapshotStore.load(from: directory) == snapshot)
    }

    @Test func pushUpdatesStatusAndTotals() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("WidgetSnapshotPush-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let initial = WidgetSnapshotBuilder.build(
            sessions: [summary(id: "s1", thinking: true, updatedAt: 1_000, name: "Session")],
            hubUrl: "https://hub.example.com",
            now: 1_000
        )
        try WidgetSnapshotStore.save(initial, to: directory)

        #expect(WidgetSnapshotStore.applyPush(
            type: "permission-request", sessionId: "s1", sessionName: "Session", now: 2_000, in: directory
        ))
        var updated = try #require(WidgetSnapshotStore.load(from: directory))
        #expect(updated.sessions.first?.status == .needsApproval)
        #expect(updated.sessions.first?.pendingCount == 1)
        #expect(updated.runningCount == 0)
        #expect(updated.needsApprovalCount == 1)

        #expect(WidgetSnapshotStore.applyPush(
            type: "ready", sessionId: "s1", sessionName: "Session", now: 3_000, in: directory
        ))
        updated = try #require(WidgetSnapshotStore.load(from: directory))
        #expect(updated.sessions.first?.status == .done)
        #expect(updated.sessions.first?.pendingCount == 0)
        #expect(updated.needsApprovalCount == 0)

        #expect(WidgetSnapshotStore.applyPush(
            type: "input-request", sessionId: "s2", sessionName: "New session", now: 4_000, in: directory
        ))
        updated = try #require(WidgetSnapshotStore.load(from: directory))
        #expect(updated.sessions.first?.id == "s2")
        #expect(updated.sessions.first?.status == .needsInput)
        #expect(updated.needsInputCount == 1)

        #expect(!WidgetSnapshotStore.applyPush(
            type: "unknown", sessionId: "s2", sessionName: nil, now: 5_000, in: directory
        ))
    }
}
