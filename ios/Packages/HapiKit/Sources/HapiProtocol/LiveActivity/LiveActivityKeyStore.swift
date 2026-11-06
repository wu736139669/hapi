import Foundation

/// App Group mirror of the per-install push key used by Live Activities.
///
/// The widget extension renders Live Activity content while the device is
/// locked, where the data-protection Keychain can be unavailable
/// (`errSecNotAvailable`, -25291). The key is therefore mirrored into the
/// same protected App Group container as the widget snapshot; the container
/// is shared only with HAPI's own extensions and the file is protected with
/// `completeUntilFirstUserAuthentication`.
public enum LiveActivityKeyStore {
    public static let fileName = "live-activity-key"
    public static let keyByteCount = 32

    public static func load() -> Data? {
        guard let directory = WidgetSnapshotStore.containerURL() else { return nil }
        return load(from: directory)
    }

    public static func load(from directory: URL) -> Data? {
        let url = directory.appendingPathComponent(fileName, isDirectory: false)
        guard let data = try? Data(contentsOf: url), data.count == keyByteCount else {
            return nil
        }
        return data
    }

    @discardableResult
    public static func save(_ key: Data) -> Bool {
        guard let directory = WidgetSnapshotStore.containerURL() else { return false }
        return save(key, to: directory)
    }

    @discardableResult
    public static func save(_ key: Data, to directory: URL) -> Bool {
        guard key.count == keyByteCount else { return false }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(fileName, isDirectory: false)
            try key.write(to: url, options: .atomic)
            #if os(iOS) && !targetEnvironment(macCatalyst)
            try? FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: url.path
            )
            #endif
            return true
        } catch {
            return false
        }
    }
}
