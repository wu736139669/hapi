import { useAppearanceSkin } from '@/hooks/useAppearanceSkin'
import { useTranslation } from '@/lib/use-translation'
import { SettingsFieldLabel } from '@/components/settings/SettingsPrimitives'
import { ForestCompanion } from './ForestCompanion'
import { APPEARANCE_SKINS } from '@/lib/appearanceSkin'

const LABEL_KEYS = {
    default: 'settings.display.skin.default',
    'forest-adventure': 'settings.display.skin.forest',
    'macaron-gradient': 'settings.display.skin.macaron',
    'macaron-peach': 'settings.display.skin.macaronPeach',
    'macaron-mint': 'settings.display.skin.macaronMint',
    'macaron-blueberry': 'settings.display.skin.macaronBlueberry',
    'macaron-lemon': 'settings.display.skin.macaronLemon',
    'macaron-rose': 'settings.display.skin.macaronRose',
} as const

export function AppearanceSkinPicker() {
    const { skin, setSkin } = useAppearanceSkin()
    const { t } = useTranslation()
    return (
        <div className="px-3 py-3">
            <SettingsFieldLabel description={t('settings.display.skin.description')}>{t('settings.display.skin')}</SettingsFieldLabel>
            <div role="radiogroup" aria-label={t('settings.display.skin')} className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {APPEARANCE_SKINS.map((option, index) => (
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
                            const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
                            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? APPEARANCE_SKINS.length - 1
                                : (index + direction + APPEARANCE_SKINS.length) % APPEARANCE_SKINS.length
                            const next = APPEARANCE_SKINS[nextIndex]!
                            setSkin(next)
                            event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-skin-option="${next}"]`)?.focus()
                        }}
                        className="skin-option"
                    >
                        <span className={`skin-option__preview skin-option__preview--${option}`} aria-hidden="true">
                            {option === 'forest-adventure' ? <ForestCompanion preview /> : <span className="skin-option__sample"><i /><i /><i /></span>}
                        </span>
                        <span className="skin-option__label">
                            {t(LABEL_KEYS[option])}
                        </span>
                        {skin === option ? <span className="skin-option__check" aria-hidden="true">✓</span> : null}
                    </button>
                ))}
            </div>
        </div>
    )
}
