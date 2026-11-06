import Foundation

/// Response of `POST /api/live-activities/register`.
///
/// `remote` is false when the hub is not in direct-APNs mode: the app can
/// still show a local activity while it runs, but no remote updates will
/// arrive, so it should end on background / use a short stale date.
public struct LiveActivityRegistrationResponse: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let remote: Bool

    public init(ok: Bool, remote: Bool) {
        self.ok = ok
        self.remote = remote
    }
}

extension APIClient {
    /// `POST /api/live-activities/register` — upserts the per-activity APNs
    /// token for a session. The hub encrypts future content-state pushes
    /// with `pushKey` (the same per-install E2E key used by alert pushes).
    public func registerLiveActivityToken(
        token: String,
        deviceId: String,
        sessionId: String,
        pushKey: String
    ) async throws -> LiveActivityRegistrationResponse {
        struct RegisterRequest: Encodable {
            let token: String
            let deviceId: String
            let sessionId: String
            let pushKey: String
        }
        return try await request(
            .post,
            "/api/live-activities/register",
            body: RegisterRequest(
                token: token,
                deviceId: deviceId,
                sessionId: sessionId,
                pushKey: pushKey
            )
        )
    }

    /// `DELETE /api/live-activities/register` by activity token.
    public func unregisterLiveActivityToken(token: String) async throws {
        struct UnregisterRequest: Encodable {
            let token: String
        }
        try await requestVoid(
            .delete,
            "/api/live-activities/register",
            body: UnregisterRequest(token: token)
        )
    }

    /// `DELETE /api/live-activities/register` by device/session (used when
    /// the activity ended before its token arrived).
    public func unregisterLiveActivityTokens(deviceId: String, sessionId: String) async throws {
        struct UnregisterRequest: Encodable {
            let deviceId: String
            let sessionId: String
        }
        try await requestVoid(
            .delete,
            "/api/live-activities/register",
            body: UnregisterRequest(deviceId: deviceId, sessionId: sessionId)
        )
    }
}
