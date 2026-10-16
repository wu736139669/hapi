export type SessionHeaderSecondaryMetadataKey =
    | 'model'
    | 'reasoning'
    | 'machine'
    | 'lastActive'
    | 'updatedAt'
    | 'createdAt'
    | 'worktree'
    | 'branch'
    | 'fastMode'

const MOBILE_SECONDARY_PRIORITY: ReadonlyArray<SessionHeaderSecondaryMetadataKey> = [
    'machine',
    'lastActive',
    'model',
    'reasoning',
    'fastMode',
    'createdAt',
    'updatedAt',
    'worktree',
    'branch',
]

export function selectMobileSessionHeaderSecondary(
    available: Partial<Record<SessionHeaderSecondaryMetadataKey, boolean>>
): SessionHeaderSecondaryMetadataKey | null {
    return MOBILE_SECONDARY_PRIORITY.find((key) => available[key] === true) ?? null
}
