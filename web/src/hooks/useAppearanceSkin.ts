import { useSyncExternalStore } from 'react'
import {
    APPEARANCE_SKIN_EVENT,
    getAppearanceSkin,
    initializeAppearanceSkin,
    setAppearanceSkin,
} from '@/lib/appearanceSkin'

function subscribe(callback: () => void): () => void {
    initializeAppearanceSkin()
    window.addEventListener(APPEARANCE_SKIN_EVENT, callback)
    return () => window.removeEventListener(APPEARANCE_SKIN_EVENT, callback)
}

export function useAppearanceSkin() {
    const skin = useSyncExternalStore(subscribe, getAppearanceSkin, () => 'default' as const)
    return { skin, setSkin: setAppearanceSkin }
}
