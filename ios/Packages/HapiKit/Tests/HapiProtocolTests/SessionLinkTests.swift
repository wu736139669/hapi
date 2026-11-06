import Foundation
import HapiProtocol
import Testing

@Suite("SessionLink parsing")
struct SessionLinkTests {
    @Test func parsesAPlainSessionLink() {
        let link = SessionLink.parse("hapicompanion://sessions/sess-123")

        #expect(link == SessionLink(sessionId: "sess-123", hubUrl: nil))
    }

    @Test func parsesAnEncodedHubHint() {
        let link = SessionLink.parse(
            "hapicompanion://sessions/sess-123?hub=https%3A%2F%2Fhapi.example.com"
        )

        #expect(link?.sessionId == "sess-123")
        #expect(link?.hubUrl == "https://hapi.example.com")
    }

    @Test func acceptsCaseInsensitiveSchemeAndHost() {
        let link = SessionLink.parse("HAPICOMPANION://SESSIONS/sess-123")

        #expect(link?.sessionId == "sess-123")
    }

    @Test func acceptsATrailingSlash() {
        #expect(SessionLink.parse("hapicompanion://sessions/sess-123/")?.sessionId == "sess-123")
    }

    @Test func ignoresABlankOrNonHTTPHubHint() {
        #expect(SessionLink.parse("hapicompanion://sessions/sess-123?hub=")?.hubUrl == nil)
        #expect(SessionLink.parse("hapicompanion://sessions/sess-123?hub=not-a-url")?.hubUrl == nil)
        #expect(SessionLink.parse("hapicompanion://sessions/sess-123?hub=ftp%3A%2F%2Fh")?.hubUrl == nil)
    }

    @Test func keepsTheFirstDuplicateHubHint() {
        let link = SessionLink.parse(
            "hapicompanion://sessions/sess-123?hub=https%3A%2F%2Fa.example.com&hub=https%3A%2F%2Fb.example.com"
        )

        #expect(link?.hubUrl == "https://a.example.com")
    }

    @Test func rejectsWrongSchemeOrHost() {
        #expect(SessionLink.parse("https://sessions/sess-123") == nil)
        #expect(SessionLink.parse("hapicompanion://session/sess-123") == nil)
        #expect(SessionLink.parse("hapicompanion://bind?hub=https%3A%2F%2Fh") == nil)
    }

    @Test func rejectsMissingOrMalformedIds() {
        #expect(SessionLink.parse("hapicompanion://sessions") == nil)
        #expect(SessionLink.parse("hapicompanion://sessions/") == nil)
        #expect(SessionLink.parse("hapicompanion://sessions/a/b") == nil)
        #expect(SessionLink.parse("hapicompanion://sessions/%20") == nil)
        #expect(SessionLink.parse("hapicompanion://sessions/%zz") == nil)
        #expect(SessionLink.parse("") == nil)
    }

    @Test func buildsTheWidgetURL() throws {
        let url = try #require(SessionLink.url(sessionId: "sess-123", hubUrl: "https://hapi.example.com"))
        let link = try #require(SessionLink.parse(url.absoluteString))

        #expect(link.sessionId == "sess-123")
        #expect(link.hubUrl == "https://hapi.example.com")
    }
}
