import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { saveSessionGuest } from '@/lib/sessionGuest'
import { useSessionGuestAuth } from './useSessionGuestAuth'

describe('useSessionGuestAuth', () => {
    beforeEach(() => {
        window.sessionStorage.clear()
    })

    it('keeps guest auth and API identities stable across rerenders', () => {
        saveSessionGuest('share-token', {
            token: 'guest-token',
            sessionId: 'session-1',
        })

        const { result, rerender } = renderHook(() => useSessionGuestAuth(
            'https://hapi.example.test',
            '/sessions/session-1',
            { share: 'share-token' },
        ))
        const first = result.current

        rerender()

        expect(result.current.auth).toBe(first.auth)
        expect(result.current.api).toBe(first.api)
        expect(result.current.shareToken).toBe('share-token')
    })
})
