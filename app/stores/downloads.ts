import { defineStore } from 'pinia'
import { sha256 } from '@noble/hashes/sha2.js'
import { localDatabase } from '../lib/local'
import { assetUrl, AUDIO_CACHE, ARTWORK_CACHE } from '../../shared/utils/media'
import { playbackKey } from '../../shared/utils/playback'
import { collectionProgress, downloadTarget } from '../../shared/utils/offline'
import type { Asset, DownloadRecord, Track, PlaybackEntry, OfflineCollection, AudioDownloadJob } from '../../shared/types/music'

export const useDownloadsStore = defineStore('downloads', () => {
  const records = ref<Record<string, DownloadRecord>>({})
  const usage = ref(0)
  const quota = ref(0)
  const persistent = ref(false)
  const available = ref(false)
  const storageError = ref('')
  const controllers = new Map<string, AbortController>()
  const pending: NonNullable<ReturnType<typeof downloadTarget>>[] = []
  const collections = ref<Record<string, OfflineCollection>>({})
  const exclusions = new Set<string>()
  const manualRequests = new Set<string>()
  const serverJobs = ref<AudioDownloadJob[]>([])
  const library = useLibraryStore()
  let reconciling = false, reconcileAgain = false
  let working = false
  const readyIds = computed(() => new Set(Object.values(records.value).filter(record => record.state === 'ready').map(record => record.trackId)))

  async function save(record: DownloadRecord) {
    const value = { ...records.value[record.trackId], ...record }
    records.value[record.trackId] = value
    await localDatabase().downloads.put(JSON.parse(JSON.stringify(value)))
  }
  async function updateStorage() {
    const estimate = await navigator.storage?.estimate?.().catch(() => null)
    usage.value = estimate?.usage || 0
    quota.value = estimate?.quota || 0
    persistent.value = await navigator.storage?.persisted?.().catch(() => false) || false
    available.value = !!navigator.serviceWorker?.controller && 'caches' in window
  }
  async function initialize() {
    try {
      const cache = await caches.open(AUDIO_CACHE)
      for (const collection of await localDatabase().offlineCollections.toArray()) collections.value[collection.key] = collection
      for (const exclusion of await localDatabase().downloadExclusions.toArray()) exclusions.add(exclusion.key)
      for (const record of await localDatabase().downloads.toArray()) {
        if (record.manual) manualRequests.add(record.trackId)
        const exists = record.state === 'ready' && record.assetId && !!await cache.match(assetUrl(record.assetId))
        if (record.state !== 'error' && !exists) {
          record.state = 'preparing'
          record.error = null
          await localDatabase().downloads.put(record)
        }
        records.value[record.trackId] = record
      }
      await updateStorage()
      navigator.serviceWorker?.addEventListener('controllerchange', () => { void updateStorage() })
      void reconcile()
    } catch { storageError.value = 'No se puede acceder al almacenamiento local. Comprueba que no estés en navegación privada.' }
  }

  async function storeAsset(track: { id: string; artwork: string | null }, asset: Asset, signal: AbortSignal) {
    const response = await fetch(assetUrl(asset.id), { signal, cache: 'no-store' })
    if (response.status !== 200 || !response.body) throw new Error('El PC no devolvió un archivo completo. Reintenta la descarga.')
    const cache = await caches.open(AUDIO_CACHE)
    const reader = response.body.getReader()
    const hash = sha256.create()
    let bytes = 0
    let lastSaved = 0
    let streamFailure: unknown
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            const digest = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('')
            if (bytes !== asset.bytes || digest !== asset.hash) throw new Error('La descarga quedó incompleta o no pasó la verificación. Reinténtala.')
            controller.close()
            return
          }
          bytes += value.byteLength
          if (bytes > asset.bytes) throw new Error('El tamaño del archivo no coincide.')
          hash.update(value)
          controller.enqueue(value)
          if (Date.now() - lastSaved > 350) {
            lastSaved = Date.now()
            await save({ trackId: track.id, assetId: asset.id, state: 'downloading', bytes, total: asset.bytes, error: null, updatedAt: Date.now() })
          }
        } catch (error) { streamFailure = error; controller.error(error); await reader.cancel().catch(() => {}) }
      },
      cancel() { void reader.cancel() },
    })
    await cache.put(assetUrl(asset.id), new Response(stream, { headers: {
      'Content-Type': asset.mime, 'Content-Length': String(asset.bytes), 'Accept-Ranges': 'bytes',
    } })).catch(error => { throw streamFailure || error })
    if (track.artwork) {
      try {
        const art = await fetch(track.artwork, { signal })
        if (art.ok) await (await caches.open(ARTWORK_CACHE)).put(track.artwork, art)
      } catch { /* The audio remains playable with a neutral cover. */ }
    }
  }

  async function drain() {
    if (working) return
    working = true
    try {
      while (pending.length) {
        const track = pending.shift()!
        const asset = track.asset
        if (records.value[track.id]?.state !== 'queued') continue
        const controller = new AbortController()
        controllers.set(track.id, controller)
        try {
          await updateStorage()
          if (quota.value && quota.value - usage.value < asset.bytes * 1.1) throw new Error('No hay espacio suficiente. Elimina alguna descarga e inténtalo de nuevo.')
          await save({ trackId: track.id, assetId: asset.id, state: 'downloading', bytes: 0, total: asset.bytes, error: null, updatedAt: Date.now() })
          for (let attempt = 0; ; attempt++) {
            try { await storeAsset(track, asset, controller.signal); break }
            catch (error) {
              if (controller.signal.aborted || attempt === 2 || (error as Error)?.name === 'QuotaExceededError'
                || /incompleta|verificación|tamaño|completo/i.test((error as Error)?.message || '')) throw error
              await new Promise<void>((resolve, reject) => {
                const aborted = () => { clearTimeout(timer); reject(controller.signal.reason) }
                const timer = setTimeout(() => { controller.signal.removeEventListener('abort', aborted); resolve() }, attempt === 0 ? 2000 : 10000)
                controller.signal.addEventListener('abort', aborted, { once: true })
              })
              controller.signal.throwIfAborted()
            }
          }
          if (controller.signal.aborted) throw new Error('Descarga cancelada.')
          await save({ trackId: track.id, assetId: asset.id, state: 'ready', bytes: asset.bytes, total: asset.bytes, error: null, updatedAt: Date.now() })
          void useLyricsStore().backfill().catch(() => {})
        } catch (error) {
          if (!Object.values(records.value).some(record => record.trackId !== track.id && record.assetId === asset.id && record.state === 'ready')) {
            await (await caches.open(AUDIO_CACHE)).delete(assetUrl(asset.id)).catch(() => {})
          }
          const message = controller.signal.aborted ? 'Descarga cancelada. Puedes reintentarla.'
            : error instanceof DOMException && error.name === 'QuotaExceededError' ? 'No hay espacio suficiente. Libera espacio y reintenta.'
              : error instanceof Error ? error.message : 'No se pudo guardar la descarga.'
          await save({ trackId: track.id, assetId: asset.id, state: 'error', bytes: 0, total: asset.bytes, error: message, updatedAt: Date.now() })
        } finally { controllers.delete(track.id); await updateStorage() }
      }
    } catch { storageError.value = 'No se pudo escribir en el almacenamiento del dispositivo.' }
    finally { working = false }
  }

  async function download(tracks: Track[]) {
    return downloadEntries(tracks.map(track => ({ source: 'local', trackId: track.id })))
  }

  async function downloadEntries(entries: PlaybackEntry[], intent: 'manual' | 'automatic' = 'manual') {
    storageError.value = ''
    await updateStorage()
    if (!available.value) { storageError.value = 'Abre la versión instalada de Openfy y espera a que esté preparada para funcionar sin conexión.'; return }
    await navigator.storage?.persist?.().catch(() => false)
    for (const entry of entries) {
      const key = playbackKey(entry)
      if (intent === 'automatic' && (exclusions.has(key) || records.value[key]?.state === 'error')) continue
      if (intent === 'manual') { exclusions.delete(key); manualRequests.add(key); await localDatabase().downloadExclusions.delete(key) }
      if (['ready', 'queued', 'downloading'].includes(records.value[key]?.state || '')) continue
      await save({ trackId: key, assetId: '', entry, manual: intent === 'manual', state: 'preparing', bytes: 0, total: 0, error: null, updatedAt: Date.now() })
    }
    await reconcile()
  }

  function snapshot() { return { tracks: library.tracks, playlists: library.playlists, youtubeSongs: library.youtubeSongs } }
  function entryFor(key: string) {
    return records.value[key]?.entry || library.collectionMap.get(key)?.entry
  }
  async function saveCollection(collection: OfflineCollection) {
    collections.value[collection.key] = collection
    await localDatabase().offlineCollections.put(JSON.parse(JSON.stringify(collection)))
  }
  async function toggleCollection(kind: OfflineCollection['kind'], id: string, source?: Pick<OfflineCollection, 'title' | 'artwork' | 'entries'>) {
    const key = `${kind}:${id}`, previous = collections.value[key]
    if (previous?.enabled) { await saveCollection({ ...previous, enabled: false, updatedAt: Date.now() }); return }
    const playlist = kind === 'playlist' ? library.playlists.find(list => list.id === id) : undefined
    const entries = source?.entries || playlist?.trackIds.flatMap(key => library.collectionMap.get(key)?.entry || []) || previous?.entries || []
    await saveCollection({ key, kind, id, title: source?.title || playlist?.name || previous?.title || 'Colección',
      artwork: source?.artwork || previous?.artwork || null, entries, revision: playlist?.revision || null, enabled: true, updatedAt: Date.now() })
    await downloadEntries(entries)
  }
  function progress(key: string) { return collectionProgress(collections.value[key], readyIds.value) }

  async function reconcile() {
    if (reconciling) { reconcileAgain = true; return }
    reconciling = true
    try {
      for (const target of Object.values(collections.value).filter(target => target.enabled)) {
        if (target.kind === 'playlist') {
          const playlist = library.playlists.find(list => list.id === target.id)
          if (!playlist) {
            if (library.connected) await saveCollection({ ...target, enabled: false })
          } else if (playlist.revision !== target.revision) {
            await saveCollection({ ...target, title: playlist.name, revision: playlist.revision,
              entries: playlist.trackIds.flatMap(key => library.collectionMap.get(key)?.entry || []), updatedAt: Date.now() })
          }
        }
        for (const entry of collections.value[target.key]!.entries) {
          const key = playbackKey(entry)
          if (exclusions.has(key) || records.value[key]) continue
          await save({ trackId: key, entry, assetId: '', state: 'preparing', bytes: 0, total: 0, error: null, updatedAt: Date.now() })
        }
      }
      if (!library.connected || !navigator.onLine || !available.value) return
      const waiting = Object.values(records.value).filter(record => record.state === 'preparing' && !exclusions.has(record.trackId))
      const missing = waiting.flatMap(record => {
        const entry = entryFor(record.trackId)
        return entry?.source === 'youtube' && !downloadTarget(entry, snapshot()) ? [entry.song] : []
      })
      for (const requestIntent of ['manual', 'automatic'] as const) {
        const songs = missing.filter(song => manualRequests.has(`youtube:${song.videoId}`) === (requestIntent === 'manual'))
        for (let offset = 0; offset < songs.length; offset += 100) {
          const batch = songs.slice(offset, offset + 100)
          const jobs = await $fetch<AudioDownloadJob[]>('/api/music/downloads', { method: 'POST', body: { songs: batch, intent: requestIntent }, retry: 0 })
          if (requestIntent === 'manual') for (const song of batch) {
            const key = `youtube:${song.videoId}`, record = records.value[key]
            manualRequests.delete(key)
            if (record) await save({ ...record, manual: false })
          }
          for (const job of jobs) {
            const record = records.value[`youtube:${job.videoId}`]
            if (record?.state === 'preparing' && (job.state === 'failed' || job.suppressed)
              && !(requestIntent === 'automatic' && manualRequests.has(record.trackId))) await save({ ...record, state: 'error', error: job.error || 'La copia del PC se eliminó o canceló. Pulsa reintentar para descargarla.' })
          }
        }
      }
      if (missing.length) serverJobs.value = await $fetch<AudioDownloadJob[]>('/api/music/downloads', { retry: 0 })
      for (const record of waiting) {
        if (records.value[record.trackId]?.state !== 'preparing') continue
        const entry = entryFor(record.trackId), target = entry && downloadTarget(entry, snapshot())
        if (!target || exclusions.has(record.trackId)) continue
        await save({ ...record, entry, artwork: target.artwork, assetId: target.asset.id, total: target.asset.bytes, state: 'queued' })
        pending.push(target)
      }
      void drain()
    } catch { /* Pending intents survive a disconnected PC and retry after the next library refresh. */ }
    finally {
      reconciling = false
      if (reconcileAgain) { reconcileAgain = false; void reconcile() }
    }
  }
  function preparationLabel(record: DownloadRecord) {
    if (!library.connected) return 'Esperando al PC'
    const job = serverJobs.value.find(job => `youtube:${job.videoId}` === record.trackId)
    return job?.state === 'downloading' ? `Descargando al PC ${job.total ? Math.round(job.bytes / job.total * 100) : 0} %`
      : job?.state === 'processing' ? 'Preparando audio' : 'Pendiente de preparación en el PC'
  }
  async function retry(key: string) { const entry = entryFor(key); if (entry) await downloadEntries([entry]) }
  async function invalidate(key: string) {
    const record = records.value[key]
    if (record?.state === 'ready') await save({ ...record, state: 'error', error: 'No se pudo abrir la copia local. Vuelve a descargarla.' })
  }
  async function exclude(key: string) {
    exclusions.add(key)
    await localDatabase().downloadExclusions.put({ key })
  }

  async function cancel(trackId: string) {
    await exclude(trackId)
    controllers.get(trackId)?.abort()
    const record = records.value[trackId]
    if (record && ['queued', 'preparing'].includes(record.state)) await save({ ...record, state: 'error', error: 'Descarga cancelada.', updatedAt: Date.now() })
  }
  async function remove(trackId: string) {
    if (controllers.has(trackId) || ['queued', 'preparing'].includes(records.value[trackId]?.state || '')) { await cancel(trackId); return }
    const record = records.value[trackId]
    if (!record) return
    await exclude(trackId)
    if (!Object.values(records.value).some(other => other.trackId !== trackId && other.assetId === record.assetId && other.state === 'ready')) {
      await (await caches.open(AUDIO_CACHE)).delete(assetUrl(record.assetId))
    }
    await localDatabase().downloads.delete(trackId)
    delete records.value[trackId]
    await updateStorage()
  }
  return { records, readyIds, usage, quota, persistent, available, storageError, collections, serverJobs, initialize, download, downloadEntries,
    reconcile, toggleCollection, progress, preparationLabel, retry, invalidate, cancel, remove, updateStorage }
})
