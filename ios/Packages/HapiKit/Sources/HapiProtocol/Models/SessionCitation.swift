import Foundation

/// Clipboard text for citing a session in another HAPI chat — the native
/// counterpart of web `buildSessionReferenceText` (`web/src/lib/sessionReference.ts`).
/// The receiving agent parses `See session "…" (/sessions/<id>) for context`;
/// the trailing steer keeps it from treating the hub path as a local file.
public enum SessionCitation {
    /// Appended so cold pastes steer agents (shared/src/sessionCitation.ts).
    public static let steerSuffix =
        " HAPI hub peer - call inspect_peer with that session id; "
        + "do not Grep/Glob/Read /sessions/ as a local file."

    public static func path(sessionId: String) -> String {
        "/sessions/\(encodePathSegment(sessionId))"
    }

    public static func referenceText(title: String, sessionId: String) -> String {
        let path = path(sessionId: sessionId)
        let sanitized = sanitizeTitle(title)
        let base = sanitized.isEmpty
            ? "See HAPI session \(path) for context"
            : "See session \(quoted(sanitized)) (\(path)) for context"
        return "\(base).\(steerSuffix)"
    }

    /// Web sanitizer: collapse whitespace, trim, cap at 120 graphemes.
    static func sanitizeTitle(_ title: String) -> String {
        let collapsed = title
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
        return String(collapsed.prefix(120))
    }

    /// `JSON.stringify` equivalent for the title inside the prose.
    private static func quoted(_ value: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        guard let data = try? encoder.encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return "\"\(value)\""
        }
        return text
    }

    private static func encodePathSegment(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}
