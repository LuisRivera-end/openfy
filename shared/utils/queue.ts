import type { PlaybackEntry, PlaybackSnapshot, PlaybackSnapshotV2, PlaybackSnapshotV3, Track } from '../types/music'
export function identifyQueue(entries: PlaybackEntry[]): PlaybackEntry[] {
  const seen = new Set<string>()
  return entries.map(entry => {
    const queueId = entry.queueId && !seen.has(entry.queueId) ? entry.queueId : crypto.randomUUID()
    seen.add(queueId)
    return { ...entry, queueId }
  })
}
export function restoreQueue(saved: PlaybackSnapshot | PlaybackSnapshotV2 | PlaybackSnapshotV3, tracks: Map<string, Track>): PlaybackSnapshotV3 {
  const raw: PlaybackEntry[] = 'version' in saved ? saved.queue : saved.queue.map(trackId => ({ source: 'local', trackId }))
  const identified = identifyQueue(raw)
  const selected = identified[saved.index]?.queueId
  const queue = identified.filter(entry => entry.source === 'local' ? tracks.has(entry.trackId) : entry.source === 'youtube' && /^[\w-]{11}$/.test(entry.song?.videoId))
  const valid = new Set(queue.map(entry => entry.queueId!))
  const originalOrder = [...new Set([...('version' in saved && saved.version === 3 ? saved.originalOrder || [] : []), ...queue.map(entry => entry.queueId!)])].filter(id => valid.has(id))
  return { ...saved, version: 3, queue, originalOrder, index: Math.max(0, queue.findIndex(entry => entry.queueId === selected)) }
}
export function reorderPending(entries: PlaybackEntry[], index: number, id: string, beforeId?: string): PlaybackEntry[] {
  const from = entries.findIndex(entry => entry.queueId === id)
  if (from <= index || (beforeId && entries.findIndex(entry => entry.queueId === beforeId) <= index)) return entries
  const result = [...entries], [entry] = result.splice(from, 1)
  const to = beforeId ? result.findIndex(item => item.queueId === beforeId) : result.length
  if (!entry || to < 0) return entries
  result.splice(to, 0, entry)
  return result
}
export function orderPending(entries: PlaybackEntry[], index: number, original: string[], randomize: boolean): PlaybackEntry[] {
  const remaining = entries.slice(index + 1)
  if (randomize) for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [remaining[i], remaining[j]] = [remaining[j]!, remaining[i]!]
  }
  else { const ranks = new Map(original.map((id, i) => [id, i])); remaining.sort((a, b) => (ranks.get(a.queueId!) ?? Infinity) - (ranks.get(b.queueId!) ?? Infinity)) }
  return [...entries.slice(0, index + 1), ...remaining]
}
