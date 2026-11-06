import Foundation

/// A connected-session bucket in the H5 sidebar.
public enum SessionListBucket: String, CaseIterable, Hashable, Sendable {
    case working
    case pending
    case active
    case idle
}

/// Top-level sections the iOS list mirrors from the web sidebar.
public enum SessionListGroupKind: String, Hashable, Sendable {
    case personalPinned
    case globalPinned
    case inProgress
    case active
    case directory
}

/// One bucket inside an In-progress / Active section.
public struct SessionListBucketGroup: Equatable, Sendable, Identifiable {
    public var bucket: SessionListBucket
    public var sessions: [SessionSummary]

    public var id: String { bucket.rawValue }

    public init(bucket: SessionListBucket, sessions: [SessionSummary]) {
        self.bucket = bucket
        self.sessions = sessions
    }
}

/// One rendered list group. Personal/global pins and directories carry
/// `sessions`; In-progress/Active groups carry `buckets`.
public struct SessionListGroup: Equatable, Sendable, Identifiable {
    public var id: String
    public var kind: SessionListGroupKind
    public var machineId: String?
    public var projectPath: String?
    public var displayName: String?
    public var sessions: [SessionSummary]
    public var buckets: [SessionListBucketGroup]
    public var hasActive: Bool
    public var hasProjectPinned: Bool

    public init(
        id: String,
        kind: SessionListGroupKind,
        machineId: String? = nil,
        projectPath: String? = nil,
        displayName: String? = nil,
        sessions: [SessionSummary] = [],
        buckets: [SessionListBucketGroup] = [],
        hasActive: Bool = false,
        hasProjectPinned: Bool = false
    ) {
        self.id = id
        self.kind = kind
        self.machineId = machineId
        self.projectPath = projectPath
        self.displayName = displayName
        self.sessions = sessions
        self.buckets = buckets
        self.hasActive = hasActive
        self.hasProjectPinned = hasProjectPinned
    }

    public var totalCount: Int {
        sessions.count + buckets.reduce(0) { $0 + $1.sessions.count }
    }
}

/// Pure port of the web sidebar grouping rules:
/// personal pins → global pins → In progress → Active sessions → directories.
public enum SessionListGrouping {
    public static let unknownMachineId = "__unknown__"

    public static func groups(
        sessions: [SessionSummary],
        personalPinned: Set<String>
    ) -> [SessionListGroup] {
        var result: [SessionListGroup] = []

        let personal = sessions
            .filter { personalPinned.contains($0.id) }
            .sorted {
                if $0.updatedAt != $1.updatedAt { return $0.updatedAt > $1.updatedAt }
                return $0.id < $1.id
            }
        if !personal.isEmpty {
            result.append(SessionListGroup(
                id: "personal",
                kind: .personalPinned,
                sessions: personal
            ))
        }

        let global = sessions.filter {
            $0.globalPinned == true && !personalPinned.contains($0.id)
        }
        if !global.isEmpty {
            result.append(SessionListGroup(
                id: "global",
                kind: .globalPinned,
                sessions: global
            ))
        }

        var working: [SessionSummary] = []
        var pending: [SessionSummary] = []
        var active: [SessionSummary] = []
        var idle: [SessionSummary] = []
        for summary in sessions {
            guard summary.active,
                  !personalPinned.contains(summary.id),
                  summary.globalPinned != true,
                  summary.pinned != true else { continue }
            if summary.thinking || summary.backgroundTaskCount > 0 {
                working.append(summary)
            } else if summary.pendingRequestsCount > 0 {
                pending.append(summary)
            } else if summary.metadata?.lifecycleState == "idle" {
                idle.append(summary)
            } else {
                active.append(summary)
            }
        }
        let inProgress = makeBuckets([
            (SessionListBucket.working, working),
            (.pending, pending),
        ])
        if !inProgress.isEmpty {
            result.append(SessionListGroup(
                id: "inProgress",
                kind: .inProgress,
                buckets: inProgress
            ))
        }
        let activeBuckets = makeBuckets([
            (.active, active),
            (.idle, idle),
        ])
        if !activeBuckets.isEmpty {
            result.append(SessionListGroup(
                id: "active",
                kind: .active,
                buckets: activeBuckets
            ))
        }

        var directories: [String: DirectoryAccumulator] = [:]
        for summary in sessions {
            guard !personalPinned.contains(summary.id),
                  summary.globalPinned != true else { continue }
            // Non-project-pinned active sessions float into the top buckets.
            if summary.active && summary.pinned != true { continue }
            let path = projectPath(summary)
            let machineId = summary.metadata?.machineId
            let key = "\(machineId ?? unknownMachineId)::\(path)"
            if directories[key] == nil {
                directories[key] = DirectoryAccumulator(
                    path: path,
                    machineId: machineId,
                    displayName: displayName(for: path)
                )
            }
            directories[key]?.sessions.append(summary)
        }

        let sortedDirectories = directories.map { key, value -> (SessionListGroup, Int) in
            let latest = value.sessions.reduce(Int.min) { partial, session in
                max(partial, session.lastUserMessageAt ?? session.createdAt ?? 0)
            }
            let group = SessionListGroup(
                id: "dir:\(key)",
                kind: .directory,
                machineId: value.machineId,
                projectPath: value.path,
                displayName: value.displayName,
                sessions: value.sessions,
                hasActive: value.sessions.contains { $0.active },
                hasProjectPinned: value.sessions.contains { $0.pinned == true }
            )
            return (group, latest)
        }
        .sorted { lhs, rhs in
            if lhs.0.hasProjectPinned != rhs.0.hasProjectPinned {
                return lhs.0.hasProjectPinned
            }
            if lhs.0.hasActive != rhs.0.hasActive {
                return lhs.0.hasActive
            }
            if lhs.1 != rhs.1 {
                return lhs.1 > rhs.1
            }
            return lhs.0.id < rhs.0.id
        }
        .map(\.0)
        result.append(contentsOf: sortedDirectories)

        return result
    }

    private static func makeBuckets(
        _ entries: [(SessionListBucket, [SessionSummary])]
    ) -> [SessionListBucketGroup] {
        entries
            .filter { !$0.1.isEmpty }
            .map { SessionListBucketGroup(bucket: $0.0, sessions: $0.1) }
    }

    private static func projectPath(_ summary: SessionSummary) -> String {
        let path = summary.metadata?.worktree?.basePath ?? summary.metadata?.path ?? ""
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Other" : trimmed
    }

    private static func displayName(for path: String) -> String {
        let components = path
            .split(whereSeparator: { $0 == "/" || $0 == "\\" })
            .map(String.init)
        guard !components.isEmpty else { return path }
        return components.suffix(2).joined(separator: "/")
    }

    private struct DirectoryAccumulator {
        var path: String
        var machineId: String?
        var displayName: String
        var sessions: [SessionSummary] = []
    }
}
