import { useEffect, useState } from 'react'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { SettingsChoiceGroup, SettingsPageContent, SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings/SettingsPrimitives'
import {
    MAX_CODEX_QUICK_IMPORT_HOURS,
    MIN_CODEX_QUICK_IMPORT_HOURS,
    normalizeCodexQuickImportHours,
    useCodexQuickImportPreferences
} from '@/hooks/useCodexQuickImportPreferences'

const locales: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
]

function CodexQuickImportSettings() {
    const { t } = useTranslation()
    const { preferences, setInitialHours, setShowLoadMore } = useCodexQuickImportPreferences()
    const [draftHours, setDraftHours] = useState(String(preferences.initialHours))

    useEffect(() => setDraftHours(String(preferences.initialHours)), [preferences.initialHours])

    const commitHours = () => {
        const parsed = draftHours.trim() === '' ? preferences.initialHours : Number(draftHours)
        const next = normalizeCodexQuickImportHours(parsed)
        setInitialHours(next)
        setDraftHours(String(next))
    }

    return (
        <SettingsSection title={t('settings.codexQuickImport.title')}>
            <SettingsRow
                label={t('settings.codexQuickImport.initialHours')}
                description={t('settings.codexQuickImport.initialHours.description')}
                trailing={(
                    <div className="flex h-9 items-center rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)]">
                        <input
                            aria-label={t('settings.codexQuickImport.initialHours')}
                            type="number"
                            inputMode="numeric"
                            min={MIN_CODEX_QUICK_IMPORT_HOURS}
                            max={MAX_CODEX_QUICK_IMPORT_HOURS}
                            value={draftHours}
                            onChange={(event) => setDraftHours(event.target.value)}
                            onBlur={commitHours}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') { commitHours(); event.currentTarget.blur() }
                                if (event.key === 'Escape') { setDraftHours(String(preferences.initialHours)); event.currentTarget.blur() }
                            }}
                            className="h-8 w-14 bg-transparent text-center text-sm text-[var(--app-fg)] outline-none"
                        />
                        <span className="flex h-8 items-center border-l border-[var(--app-border)] px-2 text-xs text-[var(--app-hint)]">
                            {t('settings.codexQuickImport.hoursUnit')}
                        </span>
                    </div>
                )}
            />
            <SettingsSwitch
                label={t('settings.codexQuickImport.showLoadMore')}
                description={t('settings.codexQuickImport.showLoadMore.description')}
                checked={preferences.showLoadMore}
                onChange={setShowLoadMore}
            />
        </SettingsSection>
    )
}

export default function SettingsGeneralPage() {
    const { t, locale, setLocale } = useTranslation()
    const { baseUrl } = useAppContext()
    return (
        <SettingsPageContent description={t('settings.general.description')}>
            <SettingsSection title={t('settings.language.label')}>
                <SettingsChoiceGroup hideLabel label={t('settings.language.label')} value={locale} options={locales} onChange={setLocale} />
            </SettingsSection>
            <CodexQuickImportSettings />
            <SettingsSection title={t('settings.companion.title')}>
                <div className="px-3 py-3">
                    <CompanionPairing baseUrl={baseUrl} />
                </div>
            </SettingsSection>
        </SettingsPageContent>
    )
}
