import type { Session, SessionSummary } from '@/types/api'
import { useAppearanceSkin } from '@/hooks/useAppearanceSkin'
import { getSessionCompanionState, type SessionCompanionState } from '@/lib/sessionCompanionState'
import { ForestAsset } from './ForestAsset'

/** A small original leaf-capped guide; the existing text remains authoritative. */
export function ForestCompanion(props: { state?: SessionCompanionState; className?: string; preview?: boolean }) {
    const state = props.state ?? 'idle'
    const waiting = state === 'permission' || state === 'waiting' || state === 'input'
    return (
        <span className={`forest-companion ${props.className ?? ''}`} data-companion-state={state} aria-hidden="true">
            <ForestAsset name="guide" className="forest-companion__sprite" preview={props.preview} />
            {waiting ? <span className="forest-companion__notice">{state === 'input' ? '?' : '!'}</span> : null}
            {state === 'working' || state === 'background' ? <span className="forest-companion__spark">✦</span> : null}
        </span>
    )
}

export function SessionForestCompanion(props: { session: Session | SessionSummary; compact?: boolean }) {
    const { skin } = useAppearanceSkin()
    if (skin !== 'forest-adventure' || props.compact) return null
    return <ForestCompanion state={getSessionCompanionState(props.session)} />
}
