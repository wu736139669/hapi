import Foundation
import HapiClient
import Testing

@MainActor
@Suite("Live Activity prefs")
struct LiveActivityPrefsTests {
    private func makeDefaults() throws -> (UserDefaults, String) {
        let suiteName = "LiveActivityPrefsTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        return (defaults, suiteName)
    }

    @Test func defaultsToDisabledAndRoundTrips() throws {
        let (defaults, suiteName) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        #expect(!LiveActivityPrefs(defaults: defaults).enabled)

        LiveActivityPrefs(defaults: defaults).setEnabled(true)
        #expect(LiveActivityPrefs(defaults: defaults).enabled)

        LiveActivityPrefs(defaults: defaults).setEnabled(false)
        #expect(!LiveActivityPrefs(defaults: defaults).enabled)
    }

    @Test func storageKeyIsStable() {
        #expect(LiveActivityPrefs.enabledKey == "settings.liveActivities")
    }
}
