import { describe, expect, it, vi } from 'vitest'
import { MusicSearchCache, type SearchBatch } from '../../server/utils/music-search'
import type { YouTubeSong } from '../../shared/types/music'

const song = (n: number): YouTubeSong => ({ videoId: String(n).padStart(11, '0'), title: `Canción ${n}`, artists: ['Openfy'], album: null, artwork: null, duration: 120 })
const batch = (first: number, count: number, next: SearchBatch['next'] = null): SearchBatch => ({ songs: Array.from({ length: count }, (_, i) => song(first + i)), next })

describe('continuous music search', () => {
  it('returns 20 initially and 10 thereafter, buffering arbitrary provider batch sizes', async () => {
    const next = vi.fn().mockResolvedValue(batch(31, 20))
    const initial = vi.fn().mockResolvedValue(batch(1, 30, next))
    const cache = new MusicSearchCache(initial)
    const first = await cache.search('Openfy')
    expect(first.songs).toHaveLength(20)
    const second = await cache.search('Openfy', first.nextCursor!)
    expect(second.songs).toEqual(batch(21, 10).songs)
    expect(next).not.toHaveBeenCalled()
    const third = await cache.search('Openfy', second.nextCursor!)
    expect(third.songs).toEqual(batch(31, 10).songs)
    const last = await cache.search('Openfy', third.nextCursor!)
    expect(last.songs).toEqual(batch(41, 10).songs)
    expect(last.nextCursor).toBeNull()
    expect(initial).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledTimes(1)
  })
  it('fills small initial batches, removes duplicates across batches, and preserves order', async () => {
    const continuation = vi.fn().mockResolvedValue(batch(11, 25))
    const cache = new MusicSearchCache(async () => batch(1, 12, continuation))
    const first = await cache.search('Openfy')
    expect(first.songs).toEqual(batch(1, 20).songs)
    const second = await cache.search('Openfy', first.nextCursor!)
    expect(second.songs).toEqual(batch(21, 10).songs)
    const last = await cache.search('Openfy', second.nextCursor!)
    expect(last.songs).toEqual(batch(31, 5).songs)
    expect(last.nextCursor).toBeNull()
  })
  it('replays a cursor without advancing it and coalesces simultaneous loads', async () => {
    let finish!: (batch: SearchBatch) => void
    const next = vi.fn().mockImplementation(() => new Promise<SearchBatch>(resolve => { finish = resolve }))
    const cache = new MusicSearchCache(async () => batch(1, 20, next))
    const first = await cache.search('Openfy')
    const left = cache.search('Openfy', first.nextCursor!)
    const right = cache.search('Openfy', first.nextCursor!)
    expect(next).toHaveBeenCalledTimes(1)
    finish(batch(21, 10))
    expect(await left).toEqual(await right)
    expect(await cache.search('Openfy', first.nextCursor!)).toEqual(await left)
    expect(next).toHaveBeenCalledTimes(1)
  })
  it('keeps the same cursor usable after a transient provider error', async () => {
    const next = vi.fn().mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValueOnce(batch(21, 10))
    const cache = new MusicSearchCache(async () => batch(1, 20, next))
    const first = await cache.search('Openfy')
    await expect(cache.search('Openfy', first.nextCursor!)).rejects.toThrow('Temporary failure')
    expect((await cache.search('Openfy', first.nextCursor!)).songs).toEqual(batch(21, 10).songs)
  })
  it('finishes when the provider has no continuation, including empty searches', async () => {
    expect(await new MusicSearchCache(async () => batch(1, 3)).search('Openfy')).toEqual({ songs: batch(1, 3).songs, nextCursor: null })
    expect(await new MusicSearchCache(async () => batch(1, 0)).search('Openfy')).toEqual({ songs: [], nextCursor: null })
  })
  it('rejects mismatched or invalid cursors and reports expired searches', async () => {
    let now = 0
    const cache = new MusicSearchCache(async () => batch(1, 30), () => now)
    const first = await cache.search('Openfy')
    await expect(cache.search('Different query', first.nextCursor!)).rejects.toMatchObject({ statusCode: 400 })
    await expect(cache.search('Openfy', 'invalid')).rejects.toMatchObject({ statusCode: 400 })
    await expect(cache.search('Openfy', first.nextCursor!.replace(':20', ':9990'))).rejects.toMatchObject({ statusCode: 400 })
    now = 16 * 60000
    await expect(cache.search('Openfy', first.nextCursor!)).rejects.toMatchObject({ code: 'SEARCH_EXPIRED', statusCode: 410 })
    expect((await cache.search('Openfy')).songs).toHaveLength(20)
  })
  it('bounds repeated empty continuations instead of entering an infinite loop', async () => {
    const next = vi.fn(async (): Promise<SearchBatch> => ({ songs: [], next }))
    const cache = new MusicSearchCache(async () => batch(1, 20, next))
    const first = await cache.search('Openfy')
    await expect(cache.search('Openfy', first.nextCursor!)).rejects.toMatchObject({ code: 'SEARCH_STALLED' })
    expect(next).toHaveBeenCalledTimes(3)
  })
})
