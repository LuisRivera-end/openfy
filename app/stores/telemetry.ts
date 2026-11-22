import { defineStore } from 'pinia'
import { localDatabase, readLocal, writeLocal } from '../lib/local'
import { ListeningAccumulator } from '../../shared/utils/telemetry'
import { playbackKey } from '../../shared/utils/playback'
import type { PlaybackEntry } from '../../shared/types/music'
import type { ListeningAcknowledgement, ListeningSession, ListeningStats } from '../../shared/types/telemetry'

export const useTelemetryStore = defineStore('telemetry', () => {
  const library = useLibraryStore()
  const stats = ref<ListeningStats>({ period: 'all', byTrack: {}, listenedMs: 0, plays: 0, lastPlayedAt: 0 })
  const pending = ref(0)
  const hasCachedStats = ref(false)
  const error = ref('')
  let deviceId = '', accumulator: ListeningAccumulator | undefined, restored: ListeningSession | undefined
  let writes = Promise.resolve(), flushing: Promise<void> | undefined
  let refreshing: Promise<void> | undefined
  async function initialize(id: string) {
    deviceId = id
    restored = await readLocal<ListeningSession>('listening-active')
    const cached = await readLocal<ListeningStats>('listening-stats')
    stats.value = cached || stats.value; hasCachedStats.value = !!cached
    pending.value = await localDatabase().listening.count()
    void flush()
  }
  function select(entry: PlaybackEntry, restore = false) {
    void checkpoint()
    const saved = restore && restored && playbackKey(restored.entry) === playbackKey(entry) ? restored : undefined
    restored = undefined
    accumulator = new ListeningAccumulator(entry, deviceId, crypto.randomUUID(), Date.now(), saved)
    accumulator.reset(0, performance.now(), Date.now(), false)
  }
  function sample(position: number, duration: number, audible: boolean) {
    accumulator?.sample(position, duration, performance.now(), Date.now(), audible)
  }
  function reset(position: number, audible = false) { accumulator?.reset(position, performance.now(), Date.now(), audible) }
  function checkpoint() {
    if (!accumulator) return writes
    const snapshot = accumulator.checkpoint()
    writes = writes.catch(() => {}).then(async () => {
      await localDatabase().transaction('rw', localDatabase().snapshots, localDatabase().listening, async () => {
        await writeLocal('listening-active', snapshot)
        if (snapshot.listenedMs > 0) await localDatabase().listening.put(snapshot)
      })
      pending.value = await localDatabase().listening.count()
      error.value = ''
    }).catch(() => { error.value = 'No se pudo guardar la escucha en este dispositivo.' })
    void writes.then(() => flush())
    return writes
  }
  function refresh(): Promise<void> {
    if (refreshing) return refreshing
    if (!library.connected) return Promise.resolve()
    return refreshing = (async () => {
      try { stats.value = await $fetch<ListeningStats>('/api/telemetry/stats', { query: { period: 'all' }, timeout: 10000, retry: 0 }); hasCachedStats.value = true; await writeLocal('listening-stats', stats.value) }
      catch { /* Keep the last synchronized statistics. */ }
      finally { refreshing = undefined }
    })()
  }
  function flush(): Promise<void> {
    if (flushing) return flushing
    if (!library.connected || !navigator.onLine) return Promise.resolve()
    flushing = (async () => {
      while (library.connected && navigator.onLine) {
        const sessions = await localDatabase().listening.orderBy('updatedAt').limit(100).toArray()
        if (!sessions.length) break
        const response = await $fetch<ListeningAcknowledgement>('/api/telemetry/listening', { method: 'POST', body: { sessions }, timeout: 15000, retry: 0 })
        await localDatabase().transaction('rw', localDatabase().listening, async () => {
          for (const acknowledgement of response.accepted) {
            const current = await localDatabase().listening.get(acknowledgement.id)
            if (current && current.sequence <= acknowledgement.sequence) await localDatabase().listening.delete(current.id)
          }
        })
      }
      pending.value = await localDatabase().listening.count()
      await refresh()
    })().catch(() => { /* Durable outbox retries on the next checkpoint or reconnection. */ }).finally(() => { flushing = undefined })
    return flushing
  }
  watch(() => library.connected, connected => { if (connected) void flush() })
  return { stats, hasCachedStats, pending, error, initialize, select, sample, reset, checkpoint, flush, refresh }
})
