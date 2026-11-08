import Foundation

/// `hapicompanion://sessions` — opens the paired session list rather than a
/// specific chat. Home-screen widgets use it for their blank/card tap; row
/// links keep the existing `hapicompanion://sessions/<id>` route.
public enum SessionListLink {
    public static let scheme = SessionLink.scheme
    public static let host = SessionLink.host

    public static var url: URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        return components.url
    }

    public static func matches(_ raw: String) -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed),
              components.scheme?.lowercased() == scheme,
              components.host?.lowercased() == host else { return false }
        return components.percentEncodedPath.isEmpty || components.percentEncodedPath == "/"
    }
}
