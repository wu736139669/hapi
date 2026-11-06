import Foundation
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

    static func pushKey() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: pushKeyAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else {
            return nil
        }
        return item as? Data
    }
}
