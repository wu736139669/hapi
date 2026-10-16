import { useAppearanceSkin } from '@/hooks/useAppearanceSkin'
import { ForestAsset } from './ForestAsset'

/** Layered artwork occupies scenery bands or sits behind opaque list surfaces. */
export function ForestScenery(props: { variant: 'list' | 'chat' }) {
    const { skin } = useAppearanceSkin()
    if (skin !== 'forest-adventure') return null
    return (
        <div className={`forest-scenery forest-scenery--${props.variant}`} aria-hidden="true">
            <div className="forest-scenery__world" />
            <ForestAsset name="lantern-tree" className="forest-scenery__tree" />
            {props.variant === 'list' ? <ForestAsset name="mushroom-cottage" className="forest-scenery__cottage" /> : null}
            <ForestAsset name="forest-portal" className="forest-scenery__portal" />
            <ForestAsset name="garden-fence" className="forest-scenery__fence" />
            {props.variant === 'chat' ? <ForestAsset name="map-compass" className="forest-scenery__map" /> : null}
            <ForestAsset name="wildflowers" className="forest-scenery__flowers" />
        </div>
    )
}
