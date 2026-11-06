import Foundation
import HapiProtocol
import Testing

@Suite("Live Activity key store")
struct LiveActivityKeyStoreTests {
    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("LiveActivityKeyStore-\(UUID().uuidString)", isDirectory: true)
    }

    @Test func roundTripsATwoHundredFiftySixBitKey() {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let key = Data((0..<32).map(UInt8.init))

        #expect(LiveActivityKeyStore.save(key, to: directory))
        #expect(LiveActivityKeyStore.load(from: directory) == key)
    }

    @Test func replacesAnExistingMirror() {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = Data(repeating: 1, count: 32)
        let second = Data(repeating: 2, count: 32)

        #expect(LiveActivityKeyStore.save(first, to: directory))
        #expect(LiveActivityKeyStore.save(second, to: directory))
        #expect(LiveActivityKeyStore.load(from: directory) == second)
    }

    @Test func rejectsNonThirtyTwoByteValues() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data([1, 2, 3]).write(
            to: directory.appendingPathComponent(LiveActivityKeyStore.fileName)
        )

        #expect(!LiveActivityKeyStore.save(Data([1, 2, 3]), to: directory))
        #expect(LiveActivityKeyStore.load(from: directory) == nil)
    }
}
