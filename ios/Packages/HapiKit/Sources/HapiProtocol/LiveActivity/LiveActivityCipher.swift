#if canImport(CryptoKit)
import CryptoKit
#endif
import Foundation

/// Why a Live Activity content-state envelope could not be opened.
public enum LiveActivityCipherError: Error, Equatable, Sendable {
    case invalidKeyLength
    case malformedEnvelope
    case unsupportedVersion
    case authenticationFailed
    case invalidJSON
    case cryptoUnavailable
}

/// AES-256-GCM envelope for Live Activity `content-state`.
///
/// The wire shape is deliberately identical to the push envelope
/// (`base64(nonce || ciphertext || tag)`), but the AAD is domain-separated
/// (`hapi-live-activity-v1`) so ciphertexts cannot be replayed between the
/// notification and Live Activity channels.
///
/// The plaintext is canonical JSON (sorted keys, no whitespace) of
/// ``LiveActivityContentState``. The hub has a byte-compatible TypeScript
/// producer; `shared/fixtures/live-activity/content-state-v1.json` pins the
/// cross-language vector.
public enum LiveActivityCipher {
    public static let aad = "hapi-live-activity-v1"
    public static let keyLength = 32
    public static let nonceLength = 12
    public static let tagLength = 16

    /// Encrypts `state` into the APNs `content-state` wrapper.
    ///
    /// `nonce` is injectable only for tests / golden-vector generation;
    /// production callers must let it default to 12 fresh random bytes.
    public static func seal(
        _ state: LiveActivityContentState,
        key: Data,
        nonce: Data? = nil
    ) throws -> EncryptedLiveActivityState {
        guard key.count == keyLength else {
            throw LiveActivityCipherError.invalidKeyLength
        }
        let plaintext = try canonicalJSON(state)
        let nonceData = nonce ?? randomNonce()
        guard nonceData.count == nonceLength else {
            throw LiveActivityCipherError.malformedEnvelope
        }
        #if canImport(CryptoKit)
        do {
            let box = try AES.GCM.seal(
                plaintext,
                using: SymmetricKey(data: key),
                nonce: AES.GCM.Nonce(data: nonceData),
                authenticating: Data(aad.utf8)
            )
            let envelope = nonceData + box.ciphertext + box.tag
            return EncryptedLiveActivityState(e: envelope.base64EncodedString())
        } catch {
            throw LiveActivityCipherError.authenticationFailed
        }
        #else
        throw LiveActivityCipherError.cryptoUnavailable
        #endif
    }

    /// Decrypts the wrapper carried in an APNs `content-state`.
    public static func open(
        _ envelope: EncryptedLiveActivityState,
        key: Data
    ) throws -> LiveActivityContentState {
        guard envelope.v == EncryptedLiveActivityState.currentVersion else {
            throw LiveActivityCipherError.unsupportedVersion
        }
        guard key.count == keyLength else {
            throw LiveActivityCipherError.invalidKeyLength
        }
        guard let raw = Data(base64Encoded: envelope.e),
              raw.count >= nonceLength + tagLength else {
            throw LiveActivityCipherError.malformedEnvelope
        }
        #if canImport(CryptoKit)
        let nonceBytes = raw.subdata(in: 0..<nonceLength)
        let ciphertext = raw.subdata(in: nonceLength..<(raw.count - tagLength))
        let tag = raw.subdata(in: (raw.count - tagLength)..<raw.count)
        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: nonceBytes),
                ciphertext: ciphertext,
                tag: tag
            )
            let plaintext = try AES.GCM.open(
                box,
                using: SymmetricKey(data: key),
                authenticating: Data(aad.utf8)
            )
            return try JSONDecoder().decode(LiveActivityContentState.self, from: plaintext)
        } catch let error as LiveActivityCipherError {
            throw error
        } catch is DecodingError {
            throw LiveActivityCipherError.invalidJSON
        } catch {
            throw LiveActivityCipherError.authenticationFailed
        }
        #else
        throw LiveActivityCipherError.cryptoUnavailable
        #endif
    }

    /// Sorted-key JSON is the canonical plaintext shared with the hub.
    public static func canonicalJSON(_ state: LiveActivityContentState) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(state)
    }

    private static func randomNonce() -> Data {
        var generator = SystemRandomNumberGenerator()
        var bytes = Data(capacity: nonceLength)
        for _ in 0..<nonceLength {
            bytes.append(UInt8.random(in: .min ... .max, using: &generator))
        }
        return bytes
    }
}
