import Foundation
import Security

/// The Anthropic API key for AI drafts, kept in the Keychain rather than in
/// the library: it never goes into backups or the iCloud Drive sync file.
/// Marked synchronizable, so iCloud Keychain carries it to your other devices.
enum APIKeyStore {
    private static let service = "com.schabbauer.AMSInstructions.anthropic"
    private static let account = "api-key"

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: kSecAttrSynchronizableAny]
    }

    static var key: String? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let text = String(data: data, encoding: .utf8), !text.isEmpty else { return nil }
        return text
    }

    static var hasKey: Bool { key != nil }

    /// "…a1b2", so you can tell which key is stored without showing it.
    static var hint: String? {
        key.map { "…" + String($0.suffix(4)) }
    }

    @discardableResult
    static func save(_ raw: String) -> Bool {
        // Pasting often brings a stray space or line break along.
        let cleaned = raw.filter { !$0.isWhitespace }
        guard !cleaned.isEmpty else { return false }
        remove()
        var item = query
        item[kSecAttrSynchronizable as String] = true
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        item[kSecValueData as String] = Data(cleaned.utf8)
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func remove() {
        SecItemDelete(query as CFDictionary)
    }
}
