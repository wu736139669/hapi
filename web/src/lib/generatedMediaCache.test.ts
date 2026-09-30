import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    _resetGeneratedMediaCacheForTests,
    loadGeneratedMediaObjectUrl,
    peekGeneratedMedia,
    subscribeGeneratedMediaEviction
} from './generatedMediaCache'

afterEach(() => {
    _resetGeneratedMediaCacheForTests()
    vi.restoreAllMocks()
})

describe('generatedMediaCache', () => {
    it('reuses a cached object URL without loading the blob again', async () => {
        const load = vi.fn(async () => new Blob(['a']))
        const first = await loadGeneratedMediaObjectUrl('s:1', load)
        const second = await loadGeneratedMediaObjectUrl('s:1', load)

        expect(second).toBe(first)
        expect(load).toHaveBeenCalledTimes(1)
    })

    it('revokes the least recently used blob once the cap is exceeded', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL')
        const urls: string[] = []
        for (const key of ['a', 'b', 'c', 'd']) {
            urls.push(await loadGeneratedMediaObjectUrl(`s:${key}`, async () => new Blob([key])))
        }

        expect(peekGeneratedMedia('s:a')).toBeNull()
        expect(peekGeneratedMedia('s:b')).toBe(urls[1])
        expect(peekGeneratedMedia('s:c')).toBe(urls[2])
        expect(peekGeneratedMedia('s:d')).toBe(urls[3])
        expect(revoke).toHaveBeenCalledWith(urls[0])
    })

    it('protects a cache hit from eviction by refreshing its position', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL')
        const a = await loadGeneratedMediaObjectUrl('s:a', async () => new Blob(['a']))
        await loadGeneratedMediaObjectUrl('s:b', async () => new Blob(['b']))
        const c = await loadGeneratedMediaObjectUrl('s:c', async () => new Blob(['c']))
        // Touch a without reloading; b is now the oldest.
        await loadGeneratedMediaObjectUrl('s:a', async () => {
            throw new Error('cache hit must not load')
        })
        const d = await loadGeneratedMediaObjectUrl('s:d', async () => new Blob(['d']))

        expect(peekGeneratedMedia('s:b')).toBeNull()
        expect(peekGeneratedMedia('s:a')).toBe(a)
        expect(peekGeneratedMedia('s:c')).toBe(c)
        expect(peekGeneratedMedia('s:d')).toBe(d)
        expect(revoke).toHaveBeenCalledTimes(1)
    })

    it('notifies holders when their entry is evicted', async () => {
        const evicted = vi.fn()
        await loadGeneratedMediaObjectUrl('s:a', async () => new Blob(['a']))
        subscribeGeneratedMediaEviction('s:a', evicted)

        await loadGeneratedMediaObjectUrl('s:b', async () => new Blob(['b']))
        await loadGeneratedMediaObjectUrl('s:c', async () => new Blob(['c']))
        expect(evicted).not.toHaveBeenCalled()

        await loadGeneratedMediaObjectUrl('s:d', async () => new Blob(['d']))
        expect(evicted).toHaveBeenCalledTimes(1)
    })

    it('stops notifying after unsubscribe', async () => {
        const evicted = vi.fn()
        await loadGeneratedMediaObjectUrl('s:a', async () => new Blob(['a']))
        const unsubscribe = subscribeGeneratedMediaEviction('s:a', evicted)
        unsubscribe()

        await loadGeneratedMediaObjectUrl('s:b', async () => new Blob(['b']))
        await loadGeneratedMediaObjectUrl('s:c', async () => new Blob(['c']))
        await loadGeneratedMediaObjectUrl('s:d', async () => new Blob(['d']))

        expect(evicted).not.toHaveBeenCalled()
    })
})
