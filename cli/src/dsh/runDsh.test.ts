import { describe, expect, it } from 'vitest'
import { shouldApplyDshPermissionPreset } from './runDsh'

describe('DeepSeek Harness permission preset resume', () => {
    it('does not resend the permission command when the native preset already matches', () => {
        expect(shouldApplyDshPermissionPreset('danger-full-access', 'danger-full-access')).toBe(false)
        expect(shouldApplyDshPermissionPreset('workspace-write', 'workspace-write')).toBe(false)
        expect(shouldApplyDshPermissionPreset('read-only', 'read-only')).toBe(false)
    })

    it('applies a requested preset when the native preset differs or is unavailable', () => {
        expect(shouldApplyDshPermissionPreset('danger-full-access', 'workspace-write')).toBe(true)
        expect(shouldApplyDshPermissionPreset('danger-full-access', null)).toBe(true)
    })

    it('leaves the native preset unchanged when HAPI requests the default mode', () => {
        expect(shouldApplyDshPermissionPreset('default', 'danger-full-access')).toBe(false)
        expect(shouldApplyDshPermissionPreset(undefined, 'danger-full-access')).toBe(false)
    })
})
