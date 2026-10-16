import { useAppearanceSkin } from '@/hooks/useAppearanceSkin'
import { useTranslation } from '@/lib/use-translation'
import { ForestAsset } from './ForestAsset'
import { ForestCompanion } from './ForestCompanion'

export function ForestBanner() {
    const { skin } = useAppearanceSkin()
    const { t } = useTranslation()
    if (skin !== 'forest-adventure') return null
    return (
        <div className="forest-banner">
            <div className="forest-banner__copy">
                <span className="forest-banner__eyebrow">HAPI · FOREST ADVENTURE</span>
                <div className="forest-banner__title"><ForestAsset name="quest-scroll" /><span>{t('skin.forest.title')}</span></div>
                <span className="forest-banner__caption">{t('skin.forest.caption')}</span>
            </div>
            <ForestAsset name="wood-corner" className="forest-banner__corner" />
            <ForestAsset name="mushrooms" className="forest-banner__mushrooms" />
            <ForestCompanion className="forest-banner__guide" />
            <ForestAsset name="lantern" className="forest-banner__lantern" />
        </div>
    )
}
