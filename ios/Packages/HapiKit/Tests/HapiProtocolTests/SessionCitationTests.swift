import Foundation
import HapiProtocol
import Testing

@Suite("Session citation reference")
struct SessionCitationTests {
    @Test func buildsTitledReferenceProse() {
        let text = SessionCitation.referenceText(title: "Fix login", sessionId: "abc-123")
        #expect(text == """
        See session "Fix login" (/sessions/abc-123) for context. \
        HAPI hub peer - call inspect_peer with that session id; \
        do not Grep/Glob/Read /sessions/ as a local file.
        """)
    }

    @Test func omitsTheTitleWhenEmpty() {
        let text = SessionCitation.referenceText(title: "   ", sessionId: "abc-123")
        #expect(text.hasPrefix("See HAPI session /sessions/abc-123 for context."))
    }

    @Test func collapsesWhitespaceAndEscapesQuotes() {
        let text = SessionCitation.referenceText(
            title: "  Fix\n\"login\"  ",
            sessionId: "abc-123"
        )
        #expect(text.contains("See session \"Fix \\\"login\\\"\" (/sessions/abc-123) for context."))
    }

    @Test func capsTheTitleAt120Characters() {
        let title = String(repeating: "a", count: 130)
        let text = SessionCitation.referenceText(title: title, sessionId: "abc-123")
        #expect(text.contains("See session \"\(String(repeating: "a", count: 120))\" "))
    }

    @Test func encodesTheSessionIdAsOnePathSegment() {
        #expect(SessionCitation.path(sessionId: "a/b c") == "/sessions/a%2Fb%20c")
    }
}
