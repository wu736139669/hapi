import Foundation
import HapiClient
import Testing

@MainActor
@Suite("Personal pin store")
struct PersonalPinStoreTests {
    private func makeDefaults() throws -> (UserDefaults, String) {
        let suiteName = "PersonalPinStoreTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        return (defaults, suiteName)
    }

    @Test func togglesAndPersistsSessionIds() throws {
        let (defaults, suiteName) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = PersonalPinStore(defaults: defaults)
        #expect(store.sessionIds.isEmpty)
        #expect(!store.contains("a"))

        store.toggle("a")
        store.toggle("b")
        #expect(store.contains("a"))
        #expect(store.contains("b"))

        let reloaded = PersonalPinStore(defaults: defaults)
        #expect(reloaded.sessionIds == ["a", "b"])

        store.toggle("a")
        #expect(!store.contains("a"))
        #expect(PersonalPinStore(defaults: defaults).sessionIds == ["b"])
    }

    @Test func corruptStorageDegradesToEmpty() throws {
        let (defaults, suiteName) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set("not-an-array", forKey: PersonalPinStore.key)

        #expect(PersonalPinStore(defaults: defaults).sessionIds.isEmpty)
    }

    @Test func storageKeyIsStable() {
        #expect(PersonalPinStore.key == "settings.personalPinnedSessions")
    }
}
