import {
    canonicalJson,
    decryptEnvelopeWithAad,
    encryptEnvelopeWithAad
} from '../push-native/envelope'

/**
 * Live Activity `content-state` contract (iOS ActivityKit).
 *
 * The APNs payload carries an AES-256-GCM envelope whose plaintext is the
 * canonical JSON of {@link LiveActivityContentState}. The AAD is separated
 * from the notification channel so a ciphertext cannot be replayed across
 * channels. The iOS side (`HapiProtocol/LiveActivity/*`) implements the same
 * wire format; `shared/fixtures/live-activity/content-state-v1.json` pins a
 * byte-for-byte vector.
 */
export const LIVE_ACTIVITY_AAD = 'hapi-live-activity-v1'
export const LIVE_ACTIVITY_STATE_VERSION = 1

export type LiveActivityStatus =
    | 'working'
    | 'needsApproval'
    | 'needsInput'
    | 'needsAttention'
    | 'done'
    | 'error'

export type LiveActivityContentState = {
    status: LiveActivityStatus
    title: string
    project: string
    startedAt: number
    updatedAt: number
    pendingCount: number
    todoCompleted: number
    todoTotal: number
    backgroundTaskCount: number
}

export type EncryptedLiveActivityState = {
    v: number
    e: string
}

/**
 * Encrypts the activity state into the APNs `content-state` shape.
 * `nonce` is injectable only for tests / vector generation.
 */
export function encryptLiveActivityState(
    state: LiveActivityContentState,
    key: Uint8Array,
    nonce?: Uint8Array
): EncryptedLiveActivityState {
    const plaintext = canonicalJson(state)
    return {
        v: LIVE_ACTIVITY_STATE_VERSION,
        e: encryptEnvelopeWithAad(key, plaintext, LIVE_ACTIVITY_AAD, nonce)
    }
}

/**
 * Test / diagnostic counterpart: opens the wrapper and returns the state.
 * The hub never needs to decrypt its own pushes in production.
 */
export function decryptLiveActivityState(
    envelope: EncryptedLiveActivityState,
    key: Uint8Array
): LiveActivityContentState {
    if (envelope.v !== LIVE_ACTIVITY_STATE_VERSION) {
        throw new Error(`unsupported Live Activity state version: ${envelope.v}`)
    }
    const plaintext = decryptEnvelopeWithAad(key, envelope.e, LIVE_ACTIVITY_AAD)
    return JSON.parse(plaintext) as LiveActivityContentState
}
