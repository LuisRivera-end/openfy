import { expect, it, vi } from 'vitest'
import { collectionLibraryFilters, defaultLibraryFilters, filterLibrary } from '../../shared/utils/library-filters'
import { identifyQueue, orderPending, restoreQueue } from '../../shared/utils/queue'
import type { LibraryItem } from '../../shared/types/music'
import { formatCollectionDuration } from '../../shared/utils/media'

it('formats a collection duration in hours and minutes', () => {
  expect(formatCollectionDuration(60000)).toBe('16 h 40 min')
  expect(formatCollectionDuration(8)).toBe('1 min')
  expect(formatCollectionDuration(0)).toBe('0 min')
})

it('removes obsolete collection restrictions while preserving usable preferences and the ranking source', () => {
  const saved = { ...defaultLibraryFilters(), query: 'sienna', downloaded: true, sort: 'plays' as const, direction: 'desc' as const, artist: 'Otra artista', album: 'Otro álbum', genre: 'Rock', source: 'local' as const, favorite: true }
  const filters = collectionLibraryFilters(saved)
  expect(filters).toEqual({ ...defaultLibraryFilters(), query: 'sienna', downloaded: true, sort: 'plays', direction: 'desc' })
  expect(saved.artist).toBe('Otra artista')
  const item = { id: 'youtube:abcdefghijk', source: 'youtube', title: 'Siénna', artist: 'The Marías', album: 'Submarine', genres: [], favorite: false } as unknown as LibraryItem
  expect(filterLibrary([item], filters, {}, new Set([item.id]))).toEqual([item])
})

it('mixes the first occurrence as well as all pending occurrences and can restore their saved order', () => {
  const original = identifyQueue(['abcdefghijk', '12345678901', 'abcdefghijk'].map(videoId => ({ source: 'youtube', song: { videoId, title: videoId, artists: [], album: null, artwork: null, duration: 120 } })))
  const random = vi.spyOn(Math, 'random').mockReturnValue(0)
  try {
    const mixed = orderPending(original, -1, [], true)
    expect(mixed[0]?.queueId).toBe(original[1]?.queueId)
    expect(new Set(mixed.map(entry => entry.queueId))).toEqual(new Set(original.map(entry => entry.queueId)))
    const saved = restoreQueue({ version: 3, queue: mixed, originalOrder: original.map(entry => entry.queueId!), index: 0, position: 5, shuffle: true, repeat: 'off', volume: .5 }, new Map())
    expect(saved.queue).toEqual(mixed)
    expect(orderPending(saved.queue, 0, saved.originalOrder, false)).toEqual([mixed[0], original[0], original[2]])
    expect(original[0]).toMatchObject({ source: 'youtube', song: { videoId: 'abcdefghijk' } })
    expect(orderPending([], -1, [], true)).toEqual([])
    expect(orderPending(original.slice(0, 1), -1, [], true)).toEqual(original.slice(0, 1))
  } finally { random.mockRestore() }
})

it('preserves each occurrence context through shuffle, reorder and queue restoration', () => {
  const song = { videoId: 'abcdefghijk', title: 'Same song', artists: [], album: null, artwork: null, duration: 100 }
  const queue = identifyQueue([
    { source: 'youtube', song, context: { kind: 'playlist', id: 'p1' } },
    { source: 'youtube', song, context: { kind: 'song' } },
    { source: 'youtube', song },
  ])
  const mixed = orderPending(queue, -1, [], true)
  const restored = restoreQueue({ version: 3, queue: mixed, index: 0, position: 0, repeat: 'all', shuffle: true, volume: .5, originalOrder: queue.map(entry => entry.queueId!) }, new Map())
  for (const entry of restored.queue) expect(entry.context).toEqual(queue.find(original => original.queueId === entry.queueId)?.context)
  expect(orderPending(restored.queue, -1, restored.originalOrder, false)).toEqual(queue)
})
