import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
    LIVE_ACTIVITY_AAD,
    encryptLiveActivityState,
    decryptLiveActivityState,
    type LiveActivityContentState
} from './liveActivityContract'
import { decryptEnvelope, encryptEnvelopeWithAad } from '../push-native/envelope'

type Fixture = {
    key_hex: string
    nonce_hex: string
    aad: string
    plaintext: string
    envelope_b64: string
}

const FIXTURE_STATE: LiveActivityContentState = {
    status: 'needsApproval',
    title: 'Claude - hapi',
    project: 'hapi',
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_060_000,
    pendingCount: 1,
    todoCompleted: 2,
    todoTotal: 5,
    backgroundTaskCount: 0
}

function loadFixture(): Fixture {
    const path = join(import.meta.dir, '../../../shared/fixtures/live-activity/content-state-v1.json')
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture
}

describe('Live Activity content-state v1', () => {
    it('reproduces the cross-language golden vector', () => {
        const fixture = loadFixture()
        expect(fixture.aad).toBe(LIVE_ACTIVITY_AAD)
        const encrypted = encryptLiveActivityState(
            FIXTURE_STATE,
            Buffer.from(fixture.key_hex, 'hex'),
            Buffer.from(fixture.nonce_hex, 'hex')
        )
        expect(encrypted.v).toBe(1)
        expect(encrypted.e).toBe(fixture.envelope_b64)
    })

    it('decrypts the vector back to the fixture state', () => {
        const fixture = loadFixture()
        const state = decryptLiveActivityState(
            { v: 1, e: fixture.envelope_b64 },
            Buffer.from(fixture.key_hex, 'hex')
        )
        expect(state).toEqual(FIXTURE_STATE)
    })

    it('uses canonical JSON for the plaintext', () => {
        const fixture = loadFixture()
        const plaintext = JSON.stringify(JSON.parse(fixture.plaintext))
        // The fixture plaintext is already canonical: sorted keys, no spaces.
        expect(plaintext).toBe(fixture.plaintext)
    })

    it('is domain-separated from the notification envelope AAD', () => {
        const fixture = loadFixture()
        const key = Buffer.from(fixture.key_hex, 'hex')
        // A Live Activity envelope must not open with the notification AAD.
        expect(() => decryptEnvelope(key, fixture.envelope_b64)).toThrow()
        // And a notification envelope must not open as a Live Activity state.
        const notificationEnvelope = encryptEnvelopeWithAad(
            key,
            fixture.plaintext,
            'hapi-push-v1',
            Buffer.from(fixture.nonce_hex, 'hex')
        )
        expect(() => decryptLiveActivityState({ v: 1, e: notificationEnvelope }, key)).toThrow()
    })

    it('rejects an unknown state version', () => {
        const fixture = loadFixture()
        expect(() => decryptLiveActivityState(
            { v: 2, e: fixture.envelope_b64 },
            Buffer.from(fixture.key_hex, 'hex')
        )).toThrow('unsupported Live Activity state version')
    })
})
