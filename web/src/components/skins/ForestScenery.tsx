import { useAppearanceSkin } from '@/hooks/useAppearanceSkin'

/** Full-pane decoration stays outside the list and chat layout flow. */
export function ForestScenery(props: { variant: 'list' | 'chat' }) {
    const { skin } = useAppearanceSkin()
    if (skin !== 'forest-adventure') return null
    return (
        <div className={`forest-scenery forest-scenery--${props.variant}`} aria-hidden="true">
            <div className="forest-scenery__world" />
        </div>
    )
}
