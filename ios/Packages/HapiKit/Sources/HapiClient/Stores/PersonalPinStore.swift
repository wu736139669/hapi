import Foundation
import Observation

/// Install-global, client-only personal pins ("My sessions" in the web
/// sidebar). This never talks to the hub; it is the iOS counterpart of the
/// web `localStorage` set.
@MainActor @Observable
public final class PersonalPinStore {
    public static let key = "settings.personalPinnedSessions"
    public static let shared = PersonalPinStore()

    public private(set) var sessionIds: Set<String>

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.sessionIds = Set(defaults.stringArray(forKey: Self.key) ?? [])
    }

    public func contains(_ sessionId: String) -> Bool {
        sessionIds.contains(sessionId)
    }

    public func toggle(_ sessionId: String) {
        if sessionIds.contains(sessionId) {
            sessionIds.remove(sessionId)
        } else {
            sessionIds.insert(sessionId)
        }
        persist()
    }

    public func remove(_ sessionId: String) {
        guard sessionIds.remove(sessionId) != nil else { return }
        persist()
    }

    private func persist() {
        defaults.set(sessionIds.sorted(), forKey: Self.key)
    }
}
