import Foundation

#if os(iOS) && !targetEnvironment(macCatalyst)
import ActivityKit
#endif

/// Static attributes for one session's Live Activity.
///
/// Declared unconditionally so macOS/Linux package tests can construct it;
/// the `ActivityAttributes` conformance is only compiled for iOS (not
/// Catalyst), where ActivityKit is actually available. `hubUrl` stays local:
/// it is not part of any APNs payload, and lets a recovered activity end
/// itself after a hub switch and build the right deep link.
public struct SessionActivityAttributes: Codable, Hashable, Sendable {
    public var sessionId: String
    public var hubUrl: String

    public init(sessionId: String, hubUrl: String) {
        self.sessionId = sessionId
        self.hubUrl = hubUrl
    }
}

#if os(iOS) && !targetEnvironment(macCatalyst)
extension SessionActivityAttributes: ActivityAttributes {
    public typealias ContentState = EncryptedLiveActivityState
}
#endif
