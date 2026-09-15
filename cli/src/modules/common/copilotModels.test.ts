import { afterEach, describe, expect, it, vi } from 'vitest'
import { listCopilotModelsForCwd } from './copilotModels'

describe('Copilot model discovery', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('returns an availability error without spawning a missing Copilot CLI', async () => {
        vi.stubEnv('COPILOT_CLI_PATH', '/definitely/missing/copilot')

        await expect(listCopilotModelsForCwd('/tmp/hapi-copilot-unavailable'))
            .resolves.toMatchObject({
                success: false,
                error: 'Copilot CLI is not installed or not on PATH',
                availableModels: [],
                currentModelId: null,
            })
    })
})
