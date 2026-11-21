import { expect, it, vi } from 'vitest'
import { identifyQueue, restoreQueue, reorderPending, orderPending, mixNextRound } from '../../shared/utils/queue'
import type { Track } from '../../shared/types/music'

it('preserves the selected occurrence, history and original pending order across a shuffled v3 round trip', () => {
  const entries = identifyQueue(['a', 'b', 'a', 'c'].map(trackId => ({ source: 'local', trackId })))
  const original = entries.map(entry => entry.queueId!)
  expect(new Set(original).size).toBe(4)
  const moved = reorderPending(entries, 1, original[3]!, original[2])
  expect(moved.map(entry => entry.queueId)).toEqual([original[0], original[1], original[3], original[2]])
  expect(reorderPending(moved, 1, original[1]!)).toBe(moved)
  const tracks = new Map(['a','b','c'].map(id => [id, { id } as Track]))
  const snapshot = restoreQueue({ version: 3, queue: moved, index: 1, originalOrder: original, position: 15, volume: .42, repeat: 'all', shuffle: true }, tracks)
  expect(snapshot.index).toBe(1)
  expect(snapshot.position).toBe(15)
  expect(snapshot.volume).toBe(.42)
  expect(orderPending(snapshot.queue, snapshot.index, snapshot.originalOrder, false)).toEqual(entries)
  expect(orderPending(entries, 1, original, true).slice(0, 2)).toEqual(entries.slice(0, 2))
})

it('migrates v1 and v2 without dropping duplicate songs or changing the selected occurrence', () => {
  const tracks = new Map([['a', { id: 'a' } as Track]])
  const legacy = { queue: ['missing', 'a', 'a'], index: 2, position: 24, volume: .6, repeat: 'off' as const, shuffle: false }
  for (const saved of [legacy, { ...legacy, version: 2 as const, queue: legacy.queue.map(trackId => ({ source: 'local' as const, trackId })) }]) {
    const result = restoreQueue(saved, tracks)
    expect(result.index).toBe(1); expect(new Set(result.originalOrder).size).toBe(2)
    expect(restoreQueue(result, tracks)).toEqual(result)
  }
})

it('repairs the reused original prefix while preserving history and the selected position', () => {
  const tracks = new Map([['a', { id: 'a' } as Track]])
  const entries = identifyQueue(Array.from({ length: 12 }, () => ({ source: 'local', trackId: 'a' })))
  const originalOrder = entries.map(entry => entry.queueId!)
  const oldQueue = [...entries.slice(0, 9), ...entries.slice(9).reverse()]
  const saved = { version: 3 as const, queue: oldQueue, index: 2, originalOrder, position: 21, volume: .6, repeat: 'all' as const, shuffle: true }
  const random = vi.spyOn(Math, 'random').mockReturnValue(0)
  try {
    const repaired = restoreQueue(saved, tracks)
    expect(repaired).toMatchObject({ index: 2, position: 21, originalOrder, repeatShuffleMigrated: true })
    expect(repaired.queue.slice(0, 3)).toEqual(oldQueue.slice(0, 3))
    expect(repaired.queue.slice(3)).not.toEqual(oldQueue.slice(3))
    expect(restoreQueue(repaired, tracks)).toEqual(repaired)
    expect(restoreQueue({ ...saved, repeatShuffleMigrated: true }, tracks).queue).toEqual(oldQueue)
  } finally { random.mockRestore() }
})

it('mixes each occurrence in the next round and avoids starting with the last occurrence', () => {
  const entries = identifyQueue(['a', 'b', 'a', 'c'].map(trackId => ({ source: 'local', trackId })))
  const ids = entries.map(entry => entry.queueId!)
  const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(.99)
  try {
    const round = mixNextRound(entries)
    expect(round.map(entry => entry.queueId).sort()).toEqual([...ids].sort())
    expect(round[0]!.queueId).not.toBe(ids.at(-1))
    expect(entries.map(entry => entry.queueId)).toEqual(ids)
    expect(mixNextRound(entries.slice(0, 1))).toEqual(entries.slice(0, 1))
  } finally { random.mockRestore() }
})
