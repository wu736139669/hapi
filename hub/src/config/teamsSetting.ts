import {
    getSettingsFile,
    readSettingsOrThrow,
    updateSettings,
    type Settings
} from './settings'

/**
 * Hub-persisted Agent Team feature gate.
 *
 * The running hub reads this at startup, so flipping it from the settings UI
 * takes effect after a restart. `TEAMS_ENABLED` env still wins over the file.
 */
export function isTeamsEnabledSetting(settings: Settings): boolean {
    return settings.teamsEnabled === true
}

export async function readTeamsEnabled(dataDir: string): Promise<boolean> {
    const settings = await readSettingsOrThrow(getSettingsFile(dataDir))
    return isTeamsEnabledSetting(settings)
}

export async function writeTeamsEnabled(dataDir: string, enabled: boolean): Promise<boolean> {
    return updateSettings(getSettingsFile(dataDir), (current) => {
        const settings = {
            ...current,
            teamsEnabled: enabled
        }
        return {
            settings,
            result: settings.teamsEnabled === true
        }
    })
}
