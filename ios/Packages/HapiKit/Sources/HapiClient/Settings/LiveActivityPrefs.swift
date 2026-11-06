import Foundation

/// Install-global Live Activity preference (Settings → Notifications).
///
/// Defaults to disabled; Live Activities are opt-in here. The coordinator
/// also checks the system's `ActivityAuthorizationInfo`, so a user who
/// disabled Live Activities in iOS settings is handled separately.
/// Corrupt/missing storage reads as the default, matching the other prefs
/// stores.
@MainActor @Observable
public final class LiveActivityPrefs {
    public private(set) var enabled: Bool

    private let defaults: UserDefaults

    public static let enabledKey = "settings.liveActivities"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.enabled = defaults.object(forKey: Self.enabledKey) as? Bool ?? false
    }

    public func setEnabled(_ enabled: Bool) {
        self.enabled = enabled
        defaults.set(enabled, forKey: Self.enabledKey)
    }
}
