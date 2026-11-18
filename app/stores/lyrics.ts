import { defineStore } from 'pinia'
import { localDatabase } from '../lib/local'
import { playbackKey } from '../../shared/utils/playback'
import { lyricsSignature, sameLyricsSignature } from '../../shared/utils/lyrics'
import type { PlaybackEntry } from '../../shared/types/music'
import { LYRICS_FORMAT, type LyricsResult } from '../../shared/types/lyrics'

export const useLyricsStore = defineStore('lyrics', () => {
  const library = useLibraryStore()
  const panelOpen = ref(false)
  const result = ref<LyricsResult | null>(null)
  const loading = ref(false)
  const error = ref('')
  const storageError = ref('')
  const offline = ref(false)
  const requests = new Map<string, Promise<LyricsResult | null>>()
  const latestSignatures = new Map<string, string>()
  const retryAt = new Map<string, { at: number; limited: boolean }>()
  let generation = 0
  let backfilling = false
  let backfillAgain = false

  function signature(entry: PlaybackEntry, duration?: number) {
    const measured = entry.source === 'youtube' ? library.youtubeSongMap.get(entry.song.videoId)?.localAudio?.duration : undefined
    return lyricsSignature(entry, entry.source === 'local' ? library.trackMap.get(entry.trackId) : undefined, duration ?? measured)
  }

  async function resolve(entry: PlaybackEntry, duration?: number, refresh = false): Promise<LyricsResult | null> {
    const key = playbackKey(entry)
    const expected = signature(entry, duration)
    const intent = JSON.stringify(expected)
    latestSignatures.set(key, intent)
    const saved = await localDatabase().lyrics.get(key).catch(() => undefined)
    const cached = saved && sameLyricsSignature(saved.signature, expected) ? saved : undefined
    const downloaded = useDownloadsStore().records[key]
    const hasDownload = !!downloaded?.assetId || !!library.youtubeSongMap.get(entry.source === 'youtube' ? entry.song.videoId : '')?.localAudio
    if (hasDownload && !refresh && cached && cached.status !== 'not_found') return cached
    const connected = library.connected && navigator.onLine
    if (!connected) return cached || null
    if (!refresh && cached && cached.format === LYRICS_FORMAT && cached.expiresAt > Date.now()) return cached
    const cooldown = retryAt.get(key)
    if (cooldown && cooldown.at > Date.now() && (!refresh || cooldown.limited)) {
      if (cached) return cached
      throw new Error('El servicio de letras está ocupado. Reintenta en unos momentos.')
    }
    const requestKey = JSON.stringify([key, expected])
    const existing = requests.get(requestKey)
    if (existing) return existing
    const work = (async () => {
      try {
        const value = await $fetch<LyricsResult>('/api/lyrics/resolve', { method: 'POST',
          body: { entry, duration, refresh }, timeout: 30000, retry: 0 })
        if (latestSignatures.get(key) === intent) await localDatabase().lyrics.put(JSON.parse(JSON.stringify(value))).catch(() => {
          storageError.value = 'La letra se puede leer, pero no se pudo guardar sin conexión en este dispositivo.'
        })
        retryAt.delete(key)
        return value
      } catch (failure: any) {
        const limited = Number(failure?.data?.data?.retryAfter) > 0
        const seconds = limited ? Number(failure.data.data.retryAfter) : 60
        retryAt.set(key, { at: Date.now() + seconds * 1000, limited })
        if (cached && cached.status !== 'not_found') return cached
        throw new Error(failure?.data?.message || 'No se pudieron consultar las letras. Vuelve a intentarlo.')
      }
    })()
    requests.set(requestKey, work)
    try { return await work } finally { requests.delete(requestKey) }
  }

  async function show(entry?: PlaybackEntry, duration?: number, refresh = false) {
    const own = ++generation
    result.value = null; error.value = ''; storageError.value = ''
    offline.value = !library.connected || !navigator.onLine
    loading.value = !!entry
    if (!entry) return
    try {
      const value = await resolve(entry, duration, refresh)
      if (own === generation) result.value = value
    } catch (failure) {
      if (own === generation) error.value = failure instanceof Error ? failure.message : 'No se pudieron consultar las letras.'
    } finally { if (own === generation) loading.value = false }
  }

  /** Runs separately from the audio download queue; a lyrics failure cannot fail audio. */
  async function backfill() {
    if (backfilling) { backfillAgain = true; return }
    if (!library.connected || !navigator.onLine) return
    backfilling = true
    try {
      for (const record of await localDatabase().downloads.toArray()) {
        if (!library.connected || !navigator.onLine) break
        if (record.state !== 'ready') continue
        const entry = record.entry || library.collectionMap.get(record.trackId)?.entry
        if (entry) await resolve(entry).catch(() => {})
      }
    } finally {
      backfilling = false
      if (backfillAgain) { backfillAgain = false; void backfill().catch(() => {}) }
    }
  }

  return { panelOpen, result, loading, error, storageError, offline, signature, resolve, show, backfill }
})
