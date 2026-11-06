import Foundation
import HapiProtocol
import Testing

@Suite("Live Activity policy")
struct LiveActivityPolicyTests {
    @Test func tracksWorkingAndWaitingSessions() {
        #expect(LiveActivityPolicy.isTracked(active: true, thinking: true, pendingRequestsCount: 0))
        #expect(LiveActivityPolicy.isTracked(active: true, thinking: false, pendingRequestsCount: 1))
        #expect(!LiveActivityPolicy.isTracked(active: false, thinking: true, pendingRequestsCount: 1))
        #expect(!LiveActivityPolicy.isTracked(active: true, thinking: false, pendingRequestsCount: 0))
    }

    @Test func pendingRequestsWinOverWorking() {
        #expect(LiveActivityPolicy.status(
            active: true,
            thinking: true,
            pendingRequestsCount: 1,
            pendingRequestKinds: [.permission]
        ) == .needsApproval)
        #expect(LiveActivityPolicy.status(
            active: true,
            thinking: true,
            pendingRequestsCount: 2,
            pendingRequestKinds: [.input]
        ) == .needsInput)
        #expect(LiveActivityPolicy.status(
            active: true,
            thinking: true,
            pendingRequestsCount: 2,
            pendingRequestKinds: [.input, .permission]
        ) == .needsAttention)
    }

    @Test func workingWhenThinkingWithoutRequests() {
        #expect(LiveActivityPolicy.status(
            active: true,
            thinking: true,
            pendingRequestsCount: 0,
            pendingRequestKinds: []
        ) == .working)
    }

    @Test func settledOrInactiveSessionsHaveNoLiveState() {
        #expect(LiveActivityPolicy.status(
            active: true,
            thinking: false,
            pendingRequestsCount: 0,
            pendingRequestKinds: []
        ) == nil)
        #expect(LiveActivityPolicy.status(
            active: false,
            thinking: true,
            pendingRequestsCount: 0,
            pendingRequestKinds: []
        ) == nil)
    }

    @Test func counterFieldsTolerateOmissionButStatusDoesNot() throws {
        let json = #"""
        {"status":"working","title":"t","project":"p","startedAt":1,"updatedAt":2}
        """#
        let state = try JSONDecoder().decode(LiveActivityContentState.self, from: Data(json.utf8))
        #expect(state.pendingCount == 0)
        #expect(state.todoCompleted == 0)
        #expect(state.todoTotal == 0)
        #expect(state.backgroundTaskCount == 0)

        let bad = #"""
        {"status":"flying","title":"t","project":"p","startedAt":1,"updatedAt":2}
        """#
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(LiveActivityContentState.self, from: Data(bad.utf8))
        }
    }
}

#if canImport(CryptoKit)
@Suite("Live Activity cipher")
struct LiveActivityCipherTests {
    private struct Fixture: Decodable {
        let keyHex: String
        let nonceHex: String
        let aad: String
        let plaintext: String
        let envelopeB64: String

        enum CodingKeys: String, CodingKey {
            case keyHex = "key_hex"
            case nonceHex = "nonce_hex"
            case aad
            case plaintext
            case envelopeB64 = "envelope_b64"
        }
    }

    private static let fixtureState = LiveActivityContentState(
        status: .needsApproval,
        title: "Claude - hapi",
        project: "hapi",
        startedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_060_000,
        pendingCount: 1,
        todoCompleted: 2,
        todoTotal: 5,
        backgroundTaskCount: 0
    )

    private static func fixture() throws -> Fixture {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("../../../shared/fixtures/live-activity/content-state-v1.json")
            .standardizedFileURL
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private static func data(hex: String) -> Data {
        var bytes = [UInt8]()
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            bytes.append(UInt8(hex[index..<next], radix: 16) ?? 0)
            index = next
        }
        return Data(bytes)
    }

    @Test func reproducesTheCrossLanguageVector() throws {
        let fixture = try Self.fixture()
        #expect(fixture.aad == LiveActivityCipher.aad)
        let envelope = try LiveActivityCipher.seal(
            Self.fixtureState,
            key: Self.data(hex: fixture.keyHex),
            nonce: Self.data(hex: fixture.nonceHex)
        )
        #expect(envelope.v == 1)
        #expect(envelope.e == fixture.envelopeB64)
    }

    @Test func decryptsTheVectorAndThePlaintextMatchesCanonicalJSON() throws {
        let fixture = try Self.fixture()
        let key = Self.data(hex: fixture.keyHex)
        let state = try LiveActivityCipher.open(
            EncryptedLiveActivityState(e: fixture.envelopeB64),
            key: key
        )
        #expect(state == Self.fixtureState)

        let canonical = try LiveActivityCipher.canonicalJSON(state)
        #expect(String(decoding: canonical, as: UTF8.self) == fixture.plaintext)
    }

    @Test func roundTripsWithAFreshNonce() throws {
        let key = Data(repeating: 0x42, count: LiveActivityCipher.keyLength)
        let envelope = try LiveActivityCipher.seal(Self.fixtureState, key: key)
        let opened = try LiveActivityCipher.open(envelope, key: key)
        #expect(opened == Self.fixtureState)
    }

    @Test func rejectsWrongKeyTamperAndVersion() throws {
        let fixture = try Self.fixture()
        let key = Self.data(hex: fixture.keyHex)
        var wrongKey = key
        wrongKey[0] ^= 0xff

        #expect(throws: LiveActivityCipherError.authenticationFailed) {
            try LiveActivityCipher.open(EncryptedLiveActivityState(e: fixture.envelopeB64), key: wrongKey)
        }
        #expect(throws: LiveActivityCipherError.unsupportedVersion) {
            try LiveActivityCipher.open(EncryptedLiveActivityState(v: 2, e: fixture.envelopeB64), key: key)
        }
        #expect(throws: LiveActivityCipherError.invalidKeyLength) {
            try LiveActivityCipher.open(
                EncryptedLiveActivityState(e: fixture.envelopeB64),
                key: Data(repeating: 0, count: 16)
            )
        }

        var raw = Data(base64Encoded: fixture.envelopeB64)!
        raw[LiveActivityCipher.nonceLength] ^= 0x01
        #expect(throws: LiveActivityCipherError.authenticationFailed) {
            try LiveActivityCipher.open(
                EncryptedLiveActivityState(e: raw.base64EncodedString()),
                key: key
            )
        }
    }

    @Test func rejectsMalformedNonceLength() throws {
        let key = Data(repeating: 0x42, count: LiveActivityCipher.keyLength)
        #expect(throws: LiveActivityCipherError.malformedEnvelope) {
            try LiveActivityCipher.seal(Self.fixtureState, key: key, nonce: Data(repeating: 0, count: 16))
        }
    }
}
#endif
