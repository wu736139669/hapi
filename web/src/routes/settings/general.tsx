import { useTranslation, type Locale } from '@/lib/use-translation'
import { useAppContext } from '@/lib/app-context'
import { useEffect, useState } from 'react'
import { CompanionPairing } from '@/components/settings/CompanionPairing'
import { SettingsChoiceGroup, SettingsPageContent, SettingsRow, SettingsSection } from '@/components/settings/SettingsPrimitives'

const locales: ReadonlyArray<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
]

function ConnectionSwitch() {
    const { t } = useTranslation()
    const { api, baseUrl, setServerUrl } = useAppContext()
    const [info, setInfo] = useState<{ publicUrl: string | null; lanUrl: string | null } | null>(null)

    useEffect(() => {
        let cancelled = false
        if (!api) {
            return
        }
        try {
            api.getServerSwitchInfo().then((result) => {
                if (!cancelled) {
                    setInfo(result)
                }
            }).catch(() => {
                // Connection info is optional — hide the switch if unavailable.
            })
        } catch {
            // Partial api clients must not break the settings page.
        }
        return () => {
            cancelled = true
        }
    }, [api])

    if (!info?.lanUrl) {
        return null
    }

    let publicOrigin: string | null = null
    try {
        publicOrigin = info.publicUrl ? new URL(info.publicUrl).origin : null
    } catch {
        publicOrigin = null
    }
    // Anything other than the public domain counts as the alternative
    // (LAN) connection — this also covers IP-based access like
    // http://192.168.x.x:3006 even when the configured lanUrl uses a
    // hostname. baseUrl is the hub the app is actually talking to — it
    // updates in place after setServerUrl() without a page reload.
    const isOnLan = baseUrl !== '' && baseUrl !== publicOrigin
    const target = isOnLan ? info.publicUrl : info.lanUrl
    if (!target) {
        return null
    }

    return (
        <SettingsSection title={t('settings.connection.title')} description={t('settings.connection.hint')}>
            <SettingsRow
                label={t('settings.connection.current')}
                trailing={<span className="max-w-[60%] truncate text-xs text-[var(--app-hint)]">{baseUrl}</span>}
            />
            <SettingsRow
                label={isOnLan ? t('settings.connection.public') : t('settings.connection.lan')}
                trailing={
                    <button
                        type="button"
                        onClick={() => {
                            // Switch the hub connection in place — the app
                            // reconnects to the target origin without a full
                            // page navigation (same hub, so the token stays
                            // valid).
                            setServerUrl(target)
                        }}
                        className="shrink-0 rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-1.5 text-xs text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]"
                    >
                        {isOnLan ? t('settings.connection.switchToPublic') : t('settings.connection.switchToLan')}
                    </button>
                }
            />
        </SettingsSection>
    )
}

export default function SettingsGeneralPage() {
    const { t, locale, setLocale } = useTranslation()
    const { baseUrl } = useAppContext()
    return (
        <SettingsPageContent description={t('settings.general.description')}>
            <ConnectionSwitch />
            <SettingsSection title={t('settings.language.label')}>
                <SettingsChoiceGroup hideLabel label={t('settings.language.label')} value={locale} options={locales} onChange={setLocale} />
            </SettingsSection>
            <SettingsSection title={t('settings.companion.title')}>
                <div className="px-3 py-3">
                    <CompanionPairing baseUrl={baseUrl} />
                </div>
            </SettingsSection>
        </SettingsPageContent>
    )
}
