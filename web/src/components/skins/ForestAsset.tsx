import { useAppearanceSkin } from '@/hooks/useAppearanceSkin'

const ASSET_SIZES = {
    guide: 144,
    'quest-scroll': 128,
    backpack: 256,
    mushrooms: 192,
    wildflowers: 192,
    'wood-corner': 128,
    'leaf-crest': 96,
    'map-compass': 192,
    lantern: 128,
} as const

/** Decorative cutouts; names, controls and state indicators remain real UI. */
export function ForestAsset(props: { name: keyof typeof ASSET_SIZES; className?: string; preview?: boolean }) {
    const { skin } = useAppearanceSkin()
    if (skin !== 'forest-adventure' && !props.preview) return null
    return (
        <img
            src={`/skins/forest-adventure/elements/${props.name}.webp`}
            width={ASSET_SIZES[props.name]}
            height={ASSET_SIZES[props.name]}
            alt=""
            aria-hidden="true"
            draggable={false}
            decoding="async"
            data-forest-asset={props.name}
            className={`forest-asset ${props.className ?? ''}`}
        />
    )
}

export function ForestEmptyIllustration() {
    const { skin } = useAppearanceSkin()
    if (skin !== 'forest-adventure') return null
    return (
        <div className="forest-empty-illustration" aria-hidden="true">
            <ForestAsset name="backpack" className="forest-empty-illustration__backpack" />
            <ForestAsset name="mushrooms" className="forest-empty-illustration__mushrooms" />
            <ForestAsset name="wildflowers" className="forest-empty-illustration__flowers" />
        </div>
    )
}
