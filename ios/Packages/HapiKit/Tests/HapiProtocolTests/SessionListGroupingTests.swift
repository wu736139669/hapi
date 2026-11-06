import Foundation
import HapiProtocol
import Testing

@Suite("Session list grouping")
struct SessionListGroupingTests {
    private func summary(
        _ id: String,
        active: Bool = true,
        thinking: Bool = false,
        pending: Int = 0,
        kinds: [PendingRequestKind] = [],
        background: Int = 0,
        pinned: Bool = false,
        globalPinned: Bool = false,
        updatedAt: Int = 1_000,
        lastUserMessageAt: Int? = nil,
        path: String = "/Users/me/projects/hapi",
        machineId: String? = "mac",
        lifecycleState: String? = nil,
        worktree: WorktreeMetadata? = nil
    ) -> SessionSummary {
        SessionSummary(
            id: id,
            active: active,
            thinking: thinking,
            activeAt: updatedAt,
            updatedAt: updatedAt,
            createdAt: updatedAt,
            lastUserMessageAt: lastUserMessageAt,
            pinned: pinned,
            globalPinned: globalPinned,
            metadata: SessionSummaryMetadata(
                path: path,
                machineId: machineId,
                worktree: worktree,
                lifecycleState: lifecycleState
            ),
            metadataVersion: 1,
            agentStateVersion: 1,
            todosUpdatedAt: 0,
            pendingRequestsCount: pending,
            pendingRequestKinds: kinds,
            backgroundTaskCount: background
        )
    }

    @Test func followsTheWebSectionOrderAndBucketPrecedence() {
        let groups = SessionListGrouping.groups(
            sessions: [
                summary("personal", updatedAt: 500),
                summary("global", globalPinned: true),
                summary("working", thinking: true),
                summary("background", background: 1),
                summary("pending", pending: 1, kinds: [.input]),
                summary("idle", lifecycleState: "idle"),
                summary("quiet"),
                summary("project", pinned: true, path: "/repo/app"),
                summary("inactive", active: false, updatedAt: 10, path: "/repo/app"),
            ],
            personalPinned: ["personal"]
        )

        let kinds: [SessionListGroupKind] = [
            .personalPinned, .globalPinned, .inProgress, .active, .directory,
        ]
        #expect(groups.map { $0.kind } == kinds)
        #expect(groups[0].sessions.map { $0.id } == ["personal"])
        #expect(groups[1].sessions.map { $0.id } == ["global"])

        let inProgress = groups[2]
        let working = inProgress.buckets[0]
        let pending = inProgress.buckets[1]
        let inProgressBuckets: [SessionListBucket] = [.working, .pending]
        #expect(inProgress.buckets.map { $0.bucket } == inProgressBuckets)
        #expect(working.sessions.map { $0.id } == ["working", "background"])
        #expect(pending.sessions.map { $0.id } == ["pending"])

        let active = groups[3]
        let activeBuckets: [SessionListBucket] = [.active, .idle]
        #expect(active.buckets.map { $0.bucket } == activeBuckets)
        #expect(active.buckets[0].sessions.map { $0.id } == ["quiet"])
        #expect(active.buckets[1].sessions.map { $0.id } == ["idle"])

        let directory = groups[4]
        #expect(directory.sessions.map { $0.id } == ["project", "inactive"])
        #expect(directory.hasActive)
        #expect(directory.hasProjectPinned)
    }

    @Test func globalPinsExcludePersonalPinsAndNeverDuplicate() {
        let groups = SessionListGrouping.groups(
            sessions: [
                summary("both", globalPinned: true),
                summary("globalOnly", globalPinned: true, updatedAt: 200),
            ],
            personalPinned: ["both"]
        )

        #expect(groups[0].kind == .personalPinned)
        #expect(groups[0].sessions.map { $0.id } == ["both"])
        #expect(groups[1].kind == .globalPinned)
        #expect(groups[1].sessions.map { $0.id } == ["globalOnly"])

        let ids = groups.flatMap { group in
            group.sessions.map { $0.id } + group.buckets.flatMap { $0.sessions.map { $0.id } }
        }
        #expect(ids.count == Set(ids).count)
    }

    @Test func personalPinsSortByUpdatedAtDescending() {
        let groups = SessionListGrouping.groups(
            sessions: [
                summary("older", updatedAt: 100),
                summary("newer", updatedAt: 300),
                summary("middle", updatedAt: 200),
            ],
            personalPinned: ["older", "newer", "middle"]
        )

        #expect(groups[0].kind == .personalPinned)
        #expect(groups[0].sessions.map { $0.id } == ["newer", "middle", "older"])
    }

    @Test func projectPinnedActiveStaysInItsDirectory() {
        let groups = SessionListGrouping.groups(
            sessions: [
                summary("projectPinned", active: true, thinking: true, pinned: true, path: "/repo/app"),
                summary("floating", active: true, thinking: true, path: "/repo/app"),
            ],
            personalPinned: []
        )

        #expect(groups.map { $0.kind } == [.inProgress, .directory])
        #expect(groups[0].buckets[0].sessions.map { $0.id } == ["floating"])
        #expect(groups[1].sessions.map { $0.id } == ["projectPinned"])
    }

    @Test func directoriesUseMachineScopedKeysAndParentLeafNames() {
        let groups = SessionListGrouping.groups(
            sessions: [
                summary("a", active: false, path: "/Users/me/projects/hapi", machineId: "mac"),
                summary("b", active: false, path: "/Users/me/projects/hapi", machineId: "linux"),
                summary("c", active: false, path: "/repo/apps/hapi", machineId: "mac"),
                summary("d", active: false, path: "/repo/other", machineId: "mac"),
            ],
            personalPinned: []
        )

        #expect(groups.allSatisfy { $0.kind == .directory })
        #expect(groups.map { $0.displayName } == [
            "projects/hapi", "projects/hapi", "apps/hapi", "repo/other",
        ])
        #expect(groups[0].machineId == "linux")
        #expect(groups[1].machineId == "mac")
        #expect(groups[0].id == "dir:linux::/Users/me/projects/hapi")
        #expect(groups[1].id == "dir:mac::/Users/me/projects/hapi")
    }

    @Test func worktreeBasePathWinsForTheDirectoryKey() {
        let worktree = WorktreeMetadata(
            basePath: "/repo/base",
            branch: "feature/x",
            name: "feature/x"
        )
        let groups = SessionListGrouping.groups(
            sessions: [
                summary("worktree", active: false, path: "/repo/base/.worktrees/x", worktree: worktree),
            ],
            personalPinned: []
        )

        #expect(groups.count == 1)
        #expect(groups[0].projectPath == "/repo/base")
        #expect(groups[0].displayName == "repo/base")
    }
}
