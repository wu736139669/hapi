import { useAppearanceSkin } from '@/hooks/useAppearanceSkin'
import { useTranslation } from '@/lib/use-translation'
import { SettingsFieldLabel } from '@/components/settings/SettingsPrimitives'
import { ForestCompanion } from './ForestCompanion'

export function AppearanceSkinPicker() {
    const { skin, setSkin } = useAppearanceSkin()
    const { t } = useTranslation()
    return (
        <div className="px-3 py-3">
            <SettingsFieldLabel description={t('settings.display.skin.description')}>{t('settings.display.skin')}</SettingsFieldLabel>
            <div role="radiogroup" aria-label={t('settings.display.skin')} className="grid grid-cols-2 gap-3">
                {(['default', 'forest-adventure'] as const).map(option => (
                    <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={skin === option}
                        tabIndex={skin === option ? 0 : -1}
                        data-skin-option={option}
                        onClick={() => setSkin(option)}
                        onKeyDown={event => {
                            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                            event.preventDefault()
                            const next = event.key === 'Home' ? 'default' : event.key === 'End' ? 'forest-adventure'
                                : option === 'default' ? 'forest-adventure' : 'default'
                            setSkin(next)
                            event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-skin-option="${next}"]`)?.focus()
                        }}
                        className="skin-option"
                    >
                        <span className={`skin-option__preview skin-option__preview--${option}`} aria-hidden="true">
                            {option === 'forest-adventure' ? <ForestCompanion preview /> : <span className="skin-option__sample"><i /><i /><i /></span>}
                        </span>
                        <span className="skin-option__label">
                            {t(option === 'default' ? 'settings.display.skin.default' : 'settings.display.skin.forest')}
                            <span className="skin-option__check" aria-hidden="true">{skin === option ? '✓' : ''}</span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    )
}
