import Foundation

/// Parsed session deep link opened by a Live Activity (or a notification
/// action that wants to reuse the same route).
///
///     hapicompanion://sessions/<id>[?hub=<encoded hub url>]
///
/// `hub` is a hint, not an authority: the app only switches to a hub that is
/// already paired and has credentials (the same guard as notification taps).
/// A blank or non-http(s) hint is ignored rather than rejecting the whole
/// link, so the session can still open on the active hub.
public struct SessionLink: Equatable, Sendable {
    public let sessionId: String
    /// The hub URL exactly as carried by the link (decoded, not normalized —
    /// hub normalization is the client layer's job).
    public let hubUrl: String?

    public init(sessionId: String, hubUrl: String? = nil) {
        self.sessionId = sessionId
        self.hubUrl = hubUrl
    }

    public static let scheme = "hapicompanion"
    public static let host = "sessions"

    /// Parses the link; nil on malformed input (wrong scheme/host, missing
    /// or oversized id, invalid percent escapes).
    public static func parse(_ raw: String) -> SessionLink? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let components = URLComponents(string: trimmed),
              components.scheme?.lowercased() == Self.scheme,
              components.host?.lowercased() == Self.host,
              hasValidPercentEncoding(components.percentEncodedPath),
              let decodedPath = components.percentEncodedPath.removingPercentEncoding else {
            return nil
        }
        let parts = decodedPath.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count == 1 else { return nil }
        let sessionId = String(parts[0])
        guard !sessionId.isEmpty,
              sessionId.count <= 256,
              !sessionId.contains("%"),
              sessionId.trimmingCharacters(in: .whitespacesAndNewlines) == sessionId else {
            return nil
        }

        let hub = components.queryItems?
            .first(where: { $0.name == "hub" })?
            .value?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let validHub = hub.flatMap { isHTTPURL($0) ? $0 : nil }
        return SessionLink(sessionId: sessionId, hubUrl: validHub)
    }

    /// The value the widget puts in `.widgetURL`.
    public static func url(sessionId: String, hubUrl: String?) -> URL? {
        var components = URLComponents()
        components.scheme = Self.scheme
        components.host = Self.host
        components.path = "/\(sessionId)"
        if let hubUrl {
            components.queryItems = [URLQueryItem(name: "hub", value: hubUrl)]
        }
        return components.url
    }

    private static func isHTTPURL(_ value: String) -> Bool {
        guard let components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty else {
            return false
        }
        return true
    }

    /// `URLComponents` tolerates a malformed escape in the path (it may
    /// leave `%zz` intact), so validate before asking Foundation to decode.
    private static func hasValidPercentEncoding(_ value: String) -> Bool {
        var index = value.startIndex
        while index < value.endIndex {
            guard value[index] == "%" else {
                index = value.index(after: index)
                continue
            }
            let first = value.index(after: index)
            guard first < value.endIndex else { return false }
            let second = value.index(after: first)
            guard second < value.endIndex,
                  value[first].isHexDigit,
                  value[second].isHexDigit else {
                return false
            }
            index = value.index(after: second)
        }
        return true
    }
}
