import Foundation

/// Small, display-only snapshot shared with the home-screen / lock-screen
/// widgets through the App Group container.
///
/// This is deliberately **not** the full `SessionSummary` list: widgets only
/// need a handful of fields, the snapshot stays well under a few KB, and it
/// contains no credentials or message content.
public struct WidgetSnapshot: Codable, Equatable, Sendable {
    public struct Session: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var project: String
        /// Reuses the Live Activity status vocabulary: `working` renders as
        /// “running”, `needsInput` as “needs reply”.
        public var status: LiveActivityContentState.Status
        /// Epoch ms of the user message that started the turn, when known.
        public var startedAt: Int?
        /// Epoch ms of the last session change.
        public var updatedAt: Int
        public var pendingCount: Int
        public var todoCompleted: Int
        public var todoTotal: Int
        public var backgroundTaskCount: Int
        /// Last human prompt, single-line and capped. Nil when unknown.
        public var lastMessage: String?

        public init(
            id: String,
            title: String,
            project: String,
            status: LiveActivityContentState.Status,
            startedAt: Int?,
            updatedAt: Int,
            pendingCount: Int = 0,
            todoCompleted: Int = 0,
            todoTotal: Int = 0,
            backgroundTaskCount: Int = 0,
            lastMessage: String? = nil
        ) {
            self.id = id
            self.title = title
            self.project = project
            self.status = status
            self.startedAt = startedAt
            self.updatedAt = updatedAt
            self.pendingCount = pendingCount
            self.todoCompleted = todoCompleted
            self.todoTotal = todoTotal
            self.backgroundTaskCount = backgroundTaskCount
            self.lastMessage = lastMessage
        }
    }

    public var generatedAt: Int
    /// Active hub origin. The widget is active-hub scoped; switching hubs
    /// overwrites the snapshot.
    public var hubUrl: String
    /// Rows shown by medium/large widgets (attention-first, capped).
    public var sessions: [Session]
    /// Totals across all tracked sessions, independent of the row cap. The
    /// small widget needs accurate counts even when more than eight sessions
    /// are running.
    public var runningCount: Int
    public var needsApprovalCount: Int
    public var needsInputCount: Int
    public var needsAttentionCount: Int
    /// Active sessions between turns; distinct from running and done.
    public var idleCount: Int

    public init(
        generatedAt: Int,
        hubUrl: String,
        sessions: [Session],
        runningCount: Int? = nil,
        needsApprovalCount: Int? = nil,
        needsInputCount: Int? = nil,
        needsAttentionCount: Int? = nil,
        idleCount: Int? = nil
    ) {
        self.generatedAt = generatedAt
        self.hubUrl = hubUrl
        self.sessions = sessions
        self.runningCount = runningCount ?? sessions.filter { $0.status == .working }.count
        self.needsApprovalCount = needsApprovalCount ?? sessions.filter { $0.status == .needsApproval }.count
        self.needsInputCount = needsInputCount ?? sessions.filter { $0.status == .needsInput }.count
        self.needsAttentionCount = needsAttentionCount ?? sessions.filter { $0.status == .needsAttention }.count
        self.idleCount = idleCount ?? sessions.filter { $0.status == .idle }.count
    }

    public static let empty = WidgetSnapshot(generatedAt: 0, hubUrl: "", sessions: [])
}

/// Builds the widget snapshot from the app's session list.
///
/// Selection is attention-first: pending requests, then running sessions,
/// then recently completed sessions (so the large widget can show a “done”
/// row). The small/medium widget uses the first rows; the large widget uses
/// up to eight.
public enum WidgetSnapshotBuilder {
    public static let defaultLimit = 20
    public static let defaultRecentWindowMs = 15 * 60 * 1000

    public static func build(
        sessions: [SessionSummary],
        hubUrl: String,
        now: Int = Int(Date().timeIntervalSince1970 * 1000),
        recentWindowMs: Int = defaultRecentWindowMs,
        limit: Int = defaultLimit
    ) -> WidgetSnapshot {
        let cutoff = now - recentWindowMs
        let rows = sessions.compactMap { summary -> WidgetSnapshot.Session? in
            let status: LiveActivityContentState.Status
            if summary.active {
                if summary.pendingRequestsCount > 0 {
                    status = LiveActivityPolicy.status(
                        active: true,
                        thinking: summary.thinking,
                        pendingRequestsCount: summary.pendingRequestsCount,
                        pendingRequestKinds: Set(summary.pendingRequestKinds)
                    ) ?? .needsAttention
                } else if summary.thinking {
                    status = .working
                } else {
                    // Active sessions between turns stay in the “active”
                    // group regardless of age, matching the web session
                    // list. The row cap keeps the widget bounded.
                    status = .idle
                }
            } else {
                guard summary.updatedAt >= cutoff else { return nil }
                status = .done
            }
            let preview = lastMessage(for: summary)
            return WidgetSnapshot.Session(
                id: summary.id,
                title: title(for: summary),
                project: projectName(for: summary),
                status: status,
                startedAt: summary.lastUserMessageAt,
                updatedAt: summary.updatedAt,
                pendingCount: summary.pendingRequestsCount,
                todoCompleted: summary.todoProgress?.completed ?? 0,
                todoTotal: summary.todoProgress?.total ?? 0,
                backgroundTaskCount: summary.backgroundTaskCount,
                lastMessage: preview.isEmpty ? nil : preview
            )
        }
        .sorted { lhs, rhs in
            let lp = priority(lhs.status)
            let rp = priority(rhs.status)
            if lp != rp { return lp > rp }
            return lhs.updatedAt > rhs.updatedAt
        }

        let limited = Array(rows.prefix(max(0, limit)))
        return WidgetSnapshot(
            generatedAt: now,
            hubUrl: hubUrl,
            sessions: limited,
            runningCount: rows.filter { $0.status == .working }.count,
            needsApprovalCount: rows.filter { $0.status == .needsApproval }.count,
            needsInputCount: rows.filter { $0.status == .needsInput }.count,
            needsAttentionCount: rows.filter { $0.status == .needsAttention }.count,
            idleCount: rows.filter { $0.status == .idle }.count
        )
    }

    public static func title(for summary: SessionSummary) -> String {
        if let name = summary.metadata?.name, !name.isEmpty { return name }
        if let text = summary.metadata?.summary?.text, !text.isEmpty { return text }
        if let prompt = summary.metadata?.promptTitle, !prompt.isEmpty { return prompt }
        if let path = summary.metadata?.path,
           let tail = path.split(separator: "/").last(where: { !$0.isEmpty }) {
            return String(tail)
        }
        return String(summary.id.prefix(8))
    }

    public static func projectName(for summary: SessionSummary) -> String {
        guard let path = summary.metadata?.path else { return "" }
        return path.split(separator: "/").last.map(String.init) ?? ""
    }

    /// One-line, length-capped preview of the latest human prompt. The hub
    /// already caps the source text; this collapses newlines and trims for
    /// the single-line widget row.
    public static func lastMessage(for summary: SessionSummary) -> String {
        guard let raw = summary.lastUserMessagePreview else { return "" }
        let collapsed = raw.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        return String(collapsed.prefix(140))
    }

    private static func priority(_ status: LiveActivityContentState.Status) -> Int {
        switch status {
        case .needsAttention: return 6
        case .needsApproval: return 5
        case .needsInput: return 4
        case .error: return 6
        case .working: return 3
        case .idle: return 2
        case .done: return 1
        }
    }
}

/// Shared App Group file store. The widget target and the app/NSE use the
/// same path; tests inject a temporary directory.
public enum WidgetSnapshotStore {
    public static let appGroupIdentifier = "group.com.wusu.hapi"
    public static let fileName = "widget-snapshot.json"
    public static let widgetKind = "HapiHomeWidget"

    /// Production location, or nil when the App Group entitlement is absent.
    public static func containerURL() -> URL? {
        #if canImport(Darwin)
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)
        #else
        return nil
        #endif
    }

    public static func fileURL(in directory: URL) -> URL {
        directory.appendingPathComponent(fileName, isDirectory: false)
    }

    public static func load() -> WidgetSnapshot? {
        guard let directory = containerURL() else { return nil }
        return load(from: directory)
    }

    public static func load(from directory: URL) -> WidgetSnapshot? {
        guard let data = try? Data(contentsOf: fileURL(in: directory)) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    public static func save(_ snapshot: WidgetSnapshot) throws {
        guard let directory = containerURL() else { return }
        try save(snapshot, to: directory)
    }

    public static func save(_ snapshot: WidgetSnapshot, to directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = fileURL(in: directory)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(snapshot).write(to: url, options: .atomic)
        #if os(iOS) && !targetEnvironment(macCatalyst)
        // The lock-screen widget must read the snapshot after first unlock.
        try? FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        #endif
    }

    /// NSE-side best-effort update from a decrypted push. The alert push
    /// carries no counts/todos, so this updates the status and pending badge
    /// while preserving the richer fields the app wrote.
    @discardableResult
    public static func applyPush(
        type: String,
        sessionId: String,
        sessionName: String?,
        now: Int = Int(Date().timeIntervalSince1970 * 1000),
        in directory: URL? = nil
    ) -> Bool {
        let existing = directory.map { load(from: $0) } ?? load()
        guard var snapshot = existing else { return false }
        let status: LiveActivityContentState.Status?
        switch type {
        case "permission-request": status = .needsApproval
        case "input-request": status = .needsInput
        case "ready", "task-notification": status = .done
        default: status = nil
        }
        guard let status else { return false }

        if let index = snapshot.sessions.firstIndex(where: { $0.id == sessionId }) {
            let old = snapshot.sessions[index].status
            snapshot.adjustCounts(for: old, by: -1)
            snapshot.sessions[index].status = status
            snapshot.sessions[index].updatedAt = now
            if status == .needsApproval || status == .needsInput {
                snapshot.sessions[index].pendingCount = max(1, snapshot.sessions[index].pendingCount)
            } else {
                snapshot.sessions[index].pendingCount = 0
            }
        } else {
            // The app may not have written this session yet (cold start or
            // another surface started it); add a minimal row.
            let title = sessionName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            snapshot.sessions.insert(WidgetSnapshot.Session(
                id: sessionId,
                title: title.isEmpty ? String(sessionId.prefix(8)) : title,
                project: "",
                status: status,
                startedAt: nil,
                updatedAt: now,
                pendingCount: status == .needsApproval || status == .needsInput ? 1 : 0
            ), at: 0)
        }
        snapshot.adjustCounts(for: status, by: 1)
        snapshot.generatedAt = now
        snapshot.sessions = Array(snapshot.sessions.prefix(WidgetSnapshotBuilder.defaultLimit))
        do {
            if let directory {
                try save(snapshot, to: directory)
            } else {
                try save(snapshot)
            }
            return true
        } catch {
            return false
        }
    }
}

private extension WidgetSnapshot {
    mutating func adjustCounts(for status: LiveActivityContentState.Status, by delta: Int) {
        switch status {
        case .working: runningCount = max(0, runningCount + delta)
        case .needsApproval: needsApprovalCount = max(0, needsApprovalCount + delta)
        case .needsInput: needsInputCount = max(0, needsInputCount + delta)
        case .needsAttention: needsAttentionCount = max(0, needsAttentionCount + delta)
        case .idle: idleCount = max(0, idleCount + delta)
        case .done, .error: break
        }
    }
}
