import Foundation

/// The plaintext payload rendered by the Live Activity widget.
///
/// This is the contract between the hub, the app, and the widget extension:
/// the hub encrypts a canonical-JSON encoding of this type into the APNs
/// `content-state`, and the widget decrypts it before rendering. Keeping it
/// in `HapiProtocol` (Foundation-only) lets hub fixtures and iOS package
/// tests pin the same shape.
public struct LiveActivityContentState: Codable, Hashable, Sendable {
    /// One glanceable state for a tracked session.
    ///
    /// Precedence mirrors the app's session-row badge: pending requests win
    /// over `working`; `done` is the terminal state carried by an end push.
    public enum Status: String, Codable, Hashable, Sendable {
        case working
        case needsApproval
        case needsInput
        case needsAttention
        /// Active session that is not currently thinking (waiting between
        /// turns). Used by the home-screen snapshot only; the hub never sends
        /// this as a Live Activity state.
        case idle
        case done
        case error
    }

    public var status: Status
    /// Session display name (`name -> summary -> promptTitle -> path -> id`).
    public var title: String
    /// Project basename for the lock-screen row.
    public var project: String
    /// Epoch ms when the current turn started.
    public var startedAt: Int
    /// Epoch ms when this state was produced.
    public var updatedAt: Int
    public var pendingCount: Int
    public var todoCompleted: Int
    public var todoTotal: Int
    public var backgroundTaskCount: Int

    public init(
        status: Status,
        title: String,
        project: String,
        startedAt: Int,
        updatedAt: Int,
        pendingCount: Int = 0,
        todoCompleted: Int = 0,
        todoTotal: Int = 0,
        backgroundTaskCount: Int = 0
    ) {
        self.status = status
        self.title = title
        self.project = project
        self.startedAt = startedAt
        self.updatedAt = updatedAt
        self.pendingCount = pendingCount
        self.todoCompleted = todoCompleted
        self.todoTotal = todoTotal
        self.backgroundTaskCount = backgroundTaskCount
    }

    /// Tolerant decode for counter fields: a future hub may omit a count
    /// without making the whole activity unreadable. Status stays strict.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decode(Status.self, forKey: .status)
        title = try container.decode(String.self, forKey: .title)
        project = try container.decode(String.self, forKey: .project)
        startedAt = try container.decode(Int.self, forKey: .startedAt)
        updatedAt = try container.decode(Int.self, forKey: .updatedAt)
        pendingCount = try container.decodeIfPresent(Int.self, forKey: .pendingCount) ?? 0
        todoCompleted = try container.decodeIfPresent(Int.self, forKey: .todoCompleted) ?? 0
        todoTotal = try container.decodeIfPresent(Int.self, forKey: .todoTotal) ?? 0
        backgroundTaskCount = try container.decodeIfPresent(Int.self, forKey: .backgroundTaskCount) ?? 0
    }
}

/// The APNs-carried wrapper: an AES-256-GCM envelope over canonical JSON of
/// ``LiveActivityContentState``. The system only needs this to be Codable;
/// the widget extension opens it with the shared per-install push key.
public struct EncryptedLiveActivityState: Codable, Hashable, Sendable {
    public static let currentVersion = 1

    public var v: Int
    /// base64(nonce[12] || ciphertext || tag[16]).
    public var e: String

    public init(v: Int = EncryptedLiveActivityState.currentVersion, e: String) {
        self.v = v
        self.e = e
    }
}

/// Pure, shared state mapping used by the app coordinator and tests.
///
/// The hub has a TypeScript counterpart for the same precedence; keep the
/// two in sync and cover both with the shared golden fixture.
public enum LiveActivityPolicy {
    /// A session gets a Live Activity while it is working or waiting for a
    /// human. Inactive/settled sessions do not.
    public static func isTracked(
        active: Bool,
        thinking: Bool,
        pendingRequestsCount: Int
    ) -> Bool {
        active && (thinking || pendingRequestsCount > 0)
    }

    /// Pending requests win over `working`, matching `SessionRowStatus`.
    /// Returns nil for a settled session (the caller ends its activity).
    public static func status(
        active: Bool,
        thinking: Bool,
        pendingRequestsCount: Int,
        pendingRequestKinds: Set<PendingRequestKind>
    ) -> LiveActivityContentState.Status? {
        guard active else { return nil }
        if pendingRequestsCount > 0 {
            if pendingRequestKinds == [.input] { return .needsInput }
            if pendingRequestKinds == [.permission] { return .needsApproval }
            return .needsAttention
        }
        return thinking ? .working : nil
    }
}
