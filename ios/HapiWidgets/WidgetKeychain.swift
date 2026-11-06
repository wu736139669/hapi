import Foundation
import HapiProtocol
import OSLog
import Security

/// Read-only Keychain access to the per-install push key shared with the app
/// and the Notification Service Extension.
///
/// The widget target carries the same `run.hapi.companion.push` Keychain
/// access group. No `kSecAttrAccessGroup` is passed: Foundation reads the
/// first accessible group, matching the app/NSE lookup. Items are stored
/// `kSecAttrAccessibleAfterFirstUnlock`, so this works while the phone is
/// locked after its first unlock since boot.
enum WidgetKeychain {
    static let service = "run.hapi.companion.push"
    static let pushKeyAccount = "pushKey"
    private static let log = Logger(subsystem: "run.hapi.companion.widget", category: "keychain")

    static func pushKey() -> Data? {
        pushKeyWithStatus().0
    }

    static func pushKeyWithStatus() -> (Data?, OSStatus) {
        // WidgetKit can render a Live Activity on the lock screen where the
        // data-protection Keychain is unavailable (-25291). The app mirrors
        // the key into the App Group exactly for this path.
        if let key = LiveActivityKeyStore.load() {
            log.info("pushKey read from app group")
            return (key, errSecSuccess)
        }
        log.error("app group pushKey unavailable; falling back to keychain")

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: pushKeyAccount,
            kSecAttrAccessGroup as String: "X75CUV458P.com.wusu.hapi.push",
            kSecUseDataProtectionKeychain as String: true,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else {
            log.error("pushKey read failed: OSStatus \(status, privacy: .public)")
            return (nil, status)
        }
        return (item as? Data, status)
    }
}
