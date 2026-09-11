import { beforeEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES,
    parseSessionListToolbarPreferences,
} from './useSessionListToolbar'

describe('session list toolbar preferences', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('uses all controls by default', () => {
        expect(parseSessionListToolbarPreferences(null)).toEqual(DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES)
    })

    it('keeps valid overrides and ignores malformed values', () => {
        expect(parseSessionListToolbarPreferences(JSON.stringify({
            showSearch: false,
            showDateFilter: false,
            collapsed: true,
            showUnreadFilter: 'no',
        }))).toEqual({
            ...DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES,
            showSearch: false,
            showDateFilter: false,
            collapsed: true,
        })
        expect(parseSessionListToolbarPreferences('{broken')).toEqual(DEFAULT_SESSION_LIST_TOOLBAR_PREFERENCES)
    })
})
