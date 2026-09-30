/**
 * Bounded cache for generated-media object URLs (videos/audio/files the user
 * explicitly loads).
 *
 * Blobs are tens of MB and the chat keeps every message mounted, so without a
 * cap each loaded video would stay in memory for the whole session. The least
 * recently used entry is revoked once a new load exceeds the cap; evicted
 * holders are notified so their card can fall back to its Load button.
 *
 * Auto-loaded images are intentionally NOT routed through here: they are small
 * and always rendered, so caching/evicting them would only cause reload churn.
 */
const MAX_CACHED_MEDIA = 3

type Entry = {
    objectUrl: string
}

/** Insertion order doubles as LRU order (Map preserves it; hits re-insert). */
const entries = new Map<string, Entry>()
const listeners = new Map<string, Set<() => void>>()

function notify(key: string): void {
    const set = listeners.get(key)
    if (!set) return
    for (const listener of [...set]) {
        listener()
    }
}

function evictOverflow(): void {
    while (entries.size > MAX_CACHED_MEDIA) {
        const oldest = entries.entries().next().value as [string, Entry] | undefined
        if (!oldest) return
        entries.delete(oldest[0])
        notify(oldest[0])
        URL.revokeObjectURL(oldest[1].objectUrl)
    }
}

/** Cache hit without loading; refreshes LRU position. */
export function peekGeneratedMedia(key: string): string | null {
    const entry = entries.get(key)
    if (!entry) return null
    entries.delete(key)
    entries.set(key, entry)
    return entry.objectUrl
}

/** Load (or reuse) the object URL for one media key, evicting the oldest over the cap. */
export async function loadGeneratedMediaObjectUrl(key: string, load: () => Promise<Blob>): Promise<string> {
    const cached = peekGeneratedMedia(key)
    if (cached) return cached

    const blob = await load()

    // A concurrent load for the same key may have finished first.
    const raced = peekGeneratedMedia(key)
    if (raced) return raced

    const objectUrl = URL.createObjectURL(blob)
    entries.set(key, { objectUrl })
    evictOverflow()
    return objectUrl
}

/** Called when this key is evicted; the holder should drop its rendered URL. */
export function subscribeGeneratedMediaEviction(key: string, listener: () => void): () => void {
    let set = listeners.get(key)
    if (!set) {
        set = new Set()
        listeners.set(key, set)
    }
    set.add(listener)
    return () => {
        set.delete(listener)
        if (set.size === 0) {
            listeners.delete(key)
        }
    }
}

/** Test helper: drop everything and revoke outstanding URLs. */
export function _resetGeneratedMediaCacheForTests(): void {
    for (const entry of entries.values()) {
        URL.revokeObjectURL(entry.objectUrl)
    }
    entries.clear()
    listeners.clear()
}
