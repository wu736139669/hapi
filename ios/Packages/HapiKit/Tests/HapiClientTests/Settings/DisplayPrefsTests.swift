import Foundation
import HapiClient
import Testing

@MainActor
@Suite("Display prefs")
struct DisplayPrefsTests {
    private func makeDefaults() throws -> (UserDefaults, String) {
        let suiteName = "DisplayPrefsTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        return (defaults, suiteName)
    }

    @Test func defaultsMatchTheH5Steps() throws {
        let (defaults, suiteName) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let prefs = DisplayPrefs(defaults: defaults)
        #expect(prefs.listFontScale == 1.0)
        #expect(prefs.codeFontSize == 13.0)
        #expect(DisplayPrefs.listFontScales == [0.8, 0.9, 1.0, 1.1, 1.2, 1.3])
        #expect(DisplayPrefs.codeFontSizes == [9, 11, 13, 15, 17])
    }

    @Test func roundTripsAndRejectsUnknownValues() throws {
        let (defaults, suiteName) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let prefs = DisplayPrefs(defaults: defaults)
        prefs.setListFontScale(1.3)
        prefs.setCodeFontSize(17)
        #expect(DisplayPrefs(defaults: defaults).listFontScale == 1.3)
        #expect(DisplayPrefs(defaults: defaults).codeFontSize == 17)

        prefs.setListFontScale(1.25)
        prefs.setCodeFontSize(14)
        #expect(prefs.listFontScale == 1.3)
        #expect(prefs.codeFontSize == 17)
    }

    @Test func corruptStorageDegradesToDefaults() throws {
        let (defaults, suiteName) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(99.0, forKey: DisplayPrefs.listFontScaleKey)
        defaults.set("large", forKey: DisplayPrefs.codeFontSizeKey)

        let prefs = DisplayPrefs(defaults: defaults)
        #expect(prefs.listFontScale == 1.0)
        #expect(prefs.codeFontSize == 13.0)
    }

    @Test func storageKeysAreStable() {
        #expect(DisplayPrefs.listFontScaleKey == "settings.sessionListFontScale")
        #expect(DisplayPrefs.codeFontSizeKey == "settings.codeFontSize")
    }
}
