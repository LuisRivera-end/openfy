import { randomUUID, createHash } from 'node:crypto'
import { createWriteStream, existsSync, statSync, statfsSync, readFileSync, rmSync } from 'node:fs'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import ffmpegPath from 'ffmpeg-static'
import { parseFile } from 'music-metadata'
import sharp from 'sharp'
import { eq, inArray, or } from 'drizzle-orm'
import { dataPaths, getDatabase } from '../database'
import { assets, audioDownloads, offlineCollections, playlists, tracks, youtubeAudio, youtubeSongs } from '../database/schema'
import { openYouTubeStream } from './youtube-stream'
import { fileHash, MAX_UPLOAD_BYTES } from './importer'
import { saveYouTubeSong, youtubeSongSchema } from './saved-music'
import { getYouTubeAlbum } from './youtube-catalog'
import { readLibrary } from './library'
import { readStoredAudioAsync } from './stored-audio'
import { notifyDesktop } from './desktop-events'
import { artworkCache } from './artwork-cache'
import { MusicProviderError, logMusicFailure } from './music-errors'
import { sessionDiagnostic } from './session-diagnostics'
import { wakeWorkers } from './workers'
import { resolveLyrics } from './lyrics'
import type { AudioDownloadJob, OfflineCollection, StoredYouTubeAudio, YouTubeSong, PlaybackEntry } from '../../shared/types/music'

let active: { id: string; controller: AbortController } | undefined
let stopping = false
export const downloadBusy = () => !!active
export const hasQueuedDownloads = () => !!getDatabase().select({ id: audioDownloads.id }).from(audioDownloads).where(eq(audioDownloads.state, 'queued')).get()
export const readAudioDownloads = () => getDatabase().select().from(audioDownloads).all().map(job =>
  job.state === 'ready' && !storedYouTubeAudio(job.videoId)
    ? { ...job, state: 'failed' as const, error: 'No se encuentra la copia completa en el PC. Vuelve a descargarla.', errorCode: 'MISSING_FILE' } : job)
export async function readAudioDownloadsAsync() {
  const jobs = getDatabase().select().from(audioDownloads).all()
  if (!jobs.some(job => job.state === 'ready')) return jobs
  const available = await readStoredAudioAsync()
  return jobs.map(job => job.state === 'ready' && !available.has(job.videoId)
    ? { ...job, state: 'failed' as const, error: 'No se encuentra la copia completa en el PC. Vuelve a descargarla.', errorCode: 'MISSING_FILE' } : job)
}
export const readOfflineCollections = () => getDatabase().select().from(offlineCollections).all()

export function storedYouTubeAudio(videoId: string): StoredYouTubeAudio | null {
  const db = getDatabase(), audio = db.select().from(youtubeAudio).where(eq(youtubeAudio.videoId, videoId)).get()
  if (!audio) return null
  const asset = db.select().from(assets).where(eq(assets.id, audio.assetId)).get()
  if (!asset) return null
  try { if (statSync(join(dataPaths().originals, asset.filename)).size !== asset.bytes) return null } catch { return null }
  const { filename: _filename, ...descriptor } = asset
  return { asset: descriptor, duration: audio.duration, artwork: audio.artwork, palette: audio.palette, downloadedAt: audio.downloadedAt }
}

function update(id: string, changes: Partial<AudioDownloadJob>) {
  const job = getDatabase().update(audioDownloads).set({ ...changes, updatedAt: Date.now() }).where(eq(audioDownloads.id, id)).returning().get()
  if (job) notifyDesktop('downloadProgress', job)
  return job
}

/** Automatic reconciliation never revives an explicit cancellation or a failed job. */
export function queueAudioDownloads(input: YouTubeSong[], intent: 'manual' | 'automatic' = 'manual') {
  const db = getDatabase(), result: AudioDownloadJob[] = []
  db.transaction(() => {
    for (const value of input) {
      const song = youtubeSongSchema.parse(value)
      saveYouTubeSong({ song })
      const old = db.select().from(audioDownloads).where(eq(audioDownloads.videoId, song.videoId)).get()
      if (old && active?.id === old.id && !['downloading', 'processing'].includes(old.state)) {
        throw new MusicProviderError('ASSET_IN_USE', 'Espera a que termine la cancelación.', 409)
      }
      const available = storedYouTubeAudio(song.videoId)
      if (old && (available || ['queued', 'downloading', 'processing'].includes(old.state)
        || intent === 'automatic' && (old.suppressed || old.state === 'failed'))) { result.push(old); continue }
      const now = Date.now()
      const job: AudioDownloadJob = { id: old?.id || randomUUID(), videoId: song.videoId, song,
        state: available ? 'ready' : 'queued', bytes: available?.asset.bytes || 0, total: available?.asset.bytes || 0,
        attempts: 0, error: null, errorCode: null, suppressed: false, createdAt: old?.createdAt || now, updatedAt: now }
      db.insert(audioDownloads).values(job).onConflictDoUpdate({ target: audioDownloads.videoId, set: job }).run()
      result.push(job)
    }
  })
  wakeWorkers()
  return result
}

export function changeAudioDownload(id: string, action: 'cancel' | 'retry') {
  const job = getDatabase().select().from(audioDownloads).where(eq(audioDownloads.id, id)).get()
  if (!job) throw new MusicProviderError('NOT_FOUND', 'No se encontró la descarga.', 404)
  if (action === 'retry') {
    if (active?.id === id) throw new MusicProviderError('ASSET_IN_USE', 'Espera a que termine la cancelación.', 409)
    return queueAudioDownloads([job.song])[0]!
  }
  if (job.state === 'ready') return job
  const changed = update(id, { state: 'cancelled', suppressed: true, error: 'Descarga cancelada.', errorCode: 'CANCELLED' })!
  if (active?.id === id) active.controller.abort()
  return changed
}

export async function removeYouTubeAudio(videoId: string) {
  const db = getDatabase()
  const job = db.select().from(audioDownloads).where(eq(audioDownloads.videoId, videoId)).get()
  if (active && active.id === job?.id) throw new MusicProviderError('ASSET_IN_USE', 'Cancela primero la descarga activa.', 409)
  const audio = db.select().from(youtubeAudio).where(eq(youtubeAudio.videoId, videoId)).get()
  const asset = audio && db.select().from(assets).where(eq(assets.id, audio.assetId)).get()
  const shared = asset && (db.select({ id: tracks.id }).from(tracks).where(or(eq(tracks.originalId, asset.id), eq(tracks.mobileId, asset.id))).get()
    || db.select().from(youtubeAudio).where(eq(youtubeAudio.assetId, asset.id)).all().some(other => other.videoId !== videoId))
  // Keep the association intact if Windows cannot remove a file currently in use.
  if (asset && !shared) {
    try { await rm(join(dataPaths().originals, asset.filename), { force: true }) }
    catch { throw new MusicProviderError('ASSET_IN_USE', 'El archivo está en uso. Pausa la canción y reintenta.', 409) }
  }
  db.transaction(() => {
    db.delete(youtubeAudio).where(eq(youtubeAudio.videoId, videoId)).run()
    if (asset && !shared) db.delete(assets).where(eq(assets.id, asset.id)).run()
    if (job) update(job.id, { state: 'removed', suppressed: true, bytes: 0, total: 0, error: null, errorCode: null })
  })
  notifyDesktop('libraryChanged')
  return { ok: true }
}

export async function setOfflineCollection(kind: OfflineCollection['kind'], id: string, enabled: boolean) {
  const db = getDatabase(), key = `${kind}:${id}`
  const previous = db.select().from(offlineCollections).where(eq(offlineCollections.key, key)).get()
  if (!enabled && previous) {
    db.update(offlineCollections).set({ enabled: false, updatedAt: Date.now() }).where(eq(offlineCollections.key, key)).run()
    return { ...previous, enabled: false }
  }
  let target: OfflineCollection
  if (kind === 'playlist') {
    const playlist = db.select().from(playlists).where(eq(playlists.id, id)).get()
    if (!playlist) throw new MusicProviderError('NOT_FOUND', 'La playlist ya no existe.', 404)
    const library = readLibrary(), songs = new Map(library.youtubeSongs?.map(saved => [`youtube:${saved.song.videoId}`, saved.song]))
    target = { key, kind, id, title: playlist.name, artwork: null, entries: playlist.trackIds.flatMap<PlaybackEntry>(trackId => {
      if (trackId.startsWith('youtube:')) { const song = songs.get(trackId); return song ? [{ source: 'youtube' as const, song }] : [] }
      return [{ source: 'local' as const, trackId }]
    }), revision: playlist.revision, enabled, updatedAt: Date.now() }
  } else {
    const album = await getYouTubeAlbum(id)
    target = { key, kind, id, title: album.title, artwork: album.artwork,
      entries: album.songs.map(song => ({ source: 'youtube', song })), revision: null, enabled, updatedAt: Date.now() }
  }
  db.insert(offlineCollections).values(target).onConflictDoUpdate({ target: offlineCollections.key, set: target }).run()
  if (enabled) queueAudioDownloads(target.entries.flatMap(entry => entry.source === 'youtube' ? [entry.song] : []), 'manual')
  notifyDesktop('libraryChanged')
  return target
}

/** Called on startup and after playlist edits; the revision makes lost wakeups recoverable. */
export function reconcileOfflineCollections(force = false) {
  const db = getDatabase(), saved = new Map(db.select().from(youtubeSongs).all().map(row => [`youtube:${row.videoId}`, row.song]))
  for (const collection of readOfflineCollections().filter(target => target.enabled)) {
    let entries = collection.entries
    if (collection.kind === 'playlist') {
      const playlist = db.select().from(playlists).where(eq(playlists.id, collection.id)).get()
      if (!playlist) { db.update(offlineCollections).set({ enabled: false }).where(eq(offlineCollections.key, collection.key)).run(); continue }
      if (!force && collection.revision === playlist.revision) continue
      entries = playlist.trackIds.flatMap<PlaybackEntry>(trackId => trackId.startsWith('youtube:')
        ? saved.has(trackId) ? [{ source: 'youtube' as const, song: saved.get(trackId)! }] : []
        : [{ source: 'local' as const, trackId }])
      if (collection.revision !== playlist.revision) db.update(offlineCollections).set({ entries, revision: playlist.revision, title: playlist.name, updatedAt: Date.now() }).where(eq(offlineCollections.key, collection.key)).run()
    }
    const known = new Set(collection.entries.flatMap(entry => entry.source === 'youtube' ? [entry.song.videoId] : []))
    queueAudioDownloads(entries.flatMap(entry => entry.source === 'youtube' && (force || !known.has(entry.song.videoId)) ? [entry.song] : []), 'automatic')
  }
}

export function resetAudioDownloads() {
  stopping = false
  // A crash between moving the file and committing SQLite leaves only this
  // generated candidate. Never remove a published asset or scan user files.
  const paths = dataPaths()
  for (const job of getDatabase().select({ id: audioDownloads.id }).from(audioDownloads).all()) {
    const marker = join(paths.staging, `${job.id}.download-publish.json`)
    if (!existsSync(marker)) continue
    try {
      const candidate = JSON.parse(readFileSync(marker, 'utf8'))?.assetId
      if (typeof candidate === 'string' && /^[a-f0-9-]{36}$/.test(candidate)
        && !getDatabase().select().from(assets).where(eq(assets.id, candidate)).get()) rmSync(join(paths.originals, `${candidate}.m4a`), { force: true })
      rmSync(marker, { force: true })
    } catch { /* Leave a locked candidate for the next startup. */ }
  }
  getDatabase().update(audioDownloads).set({ state: 'queued', bytes: 0, error: null }).where(inArray(audioDownloads.state, ['downloading', 'processing'])).run()
  reconcileOfflineCollections(true)
}
export function stopAudioDownloads() { stopping = true; active?.controller.abort() }

async function ffmpeg(args: string[], signal: AbortSignal) {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.OPENFY_FFMPEG || ffmpegPath || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], signal })
    let failure: Error | undefined
    child.stderr.on('data', () => {})
    child.on('error', error => { failure = error })
    child.on('close', code => failure ? reject(failure) : code === 0 ? resolve() : reject(new MusicProviderError('INVALID_AUDIO', 'El archivo descargado no contiene audio completo y compatible.', 422)))
  })
}

export async function prepareDownloadedAudio(raw: string, output: string, song: YouTubeSong, signal: AbortSignal) {
  await ffmpeg(['-y', '-i', raw, '-map', '0:a:0', '-vn', '-c:a', 'copy', '-metadata', `title=${song.title}`,
    '-metadata', `artist=${song.artists.join(', ')}`, '-metadata', `album=${song.album || 'YouTube Music'}`,
    '-movflags', '+faststart', '-f', 'mp4', output], signal)
  await ffmpeg(['-xerror', '-i', output, '-map', '0:a:0', '-f', 'null', '-'], signal)
  const metadata = await parseFile(output, { duration: true })
  const duration = metadata.format.duration || 0
  if (!Number.isFinite(duration) || duration <= 0 || !/AAC/i.test(metadata.format.codec || '')) throw new MusicProviderError('INVALID_AUDIO', 'No se pudo comprobar el audio descargado.', 422)
  return duration
}

async function downloadArtwork(song: YouTubeSong) {
  if (!song.artwork) return { artwork: null, palette: ['#234d3b', '#273c4e', '#3e2849'] }
  const prepared = await artworkCache().prepare(song.artwork, 1000)
  const buffer = await sharp(await readFile(prepared.path)).webp({ quality: 85 }).toBuffer()
  const hash = createHash('sha256').update(buffer).digest('hex')
  await writeFile(join(dataPaths().artwork, `${hash}.webp`), buffer)
  return { artwork: `/api/artwork/${hash}.webp`, palette: prepared.palette }
}

interface DownloadDependencies {
  open: typeof openYouTubeStream
  prepare: typeof prepareDownloadedAudio
  artwork: typeof downloadArtwork
  lyrics: (song: YouTubeSong, duration: number) => Promise<unknown>
  wait: (ms: number, signal: AbortSignal) => Promise<unknown>
}
export async function processNextDownload(overrides: Partial<DownloadDependencies> = {}) {
  if (active || stopping) return
  const db = getDatabase(), job = db.select().from(audioDownloads).where(eq(audioDownloads.state, 'queued')).get()
  if (!job) return
  const deps = { open: openYouTubeStream, prepare: prepareDownloadedAudio, artwork: downloadArtwork,
    lyrics: (song: YouTubeSong, duration: number) => resolveLyrics({ entry: { source: 'youtube', song }, duration }),
    wait: (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }), ...overrides }
  const controller = new AbortController(), signal = controller.signal
  active = { id: job.id, controller }
  const paths = dataPaths(), raw = join(paths.staging, `${job.id}.download.part`), output = join(paths.staging, `${job.id}.download.m4a`)
  const assetId = randomUUID(), destination = join(paths.originals, `${assetId}.m4a`)
  const marker = join(paths.staging, `${job.id}.download-publish.json`)
  const began = Date.now()
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      signal.throwIfAborted()
      update(job.id, { state: 'downloading', attempts: attempt, bytes: 0, total: 0, error: null, errorCode: null })
      sessionDiagnostic('audio.download', 'started', { target: job.videoId, job: job.id, attempt })
      try {
        const response = await deps.open(job.videoId, { method: 'GET', signal })
        const total = Number(response.headers.get('content-length'))
        if (response.status !== 200 || !response.body || !Number.isSafeInteger(total) || total < 1 || total > MAX_UPLOAD_BYTES) {
          await response.body?.cancel()
          throw new MusicProviderError('INVALID_SIZE', 'El audio no tiene un tamaño compatible (máximo 1 GB).', 422)
        }
        const disk = statfsSync(paths.root)
        if (disk.bavail * disk.bsize < total * 2.2 + 64 * 1024 ** 2) { await response.body.cancel(); throw new MusicProviderError('NO_SPACE', 'No hay espacio suficiente en el PC.', 507) }
        update(job.id, { total })
        let bytes = 0, lastProgress = 0
        const progress = new Transform({ transform(chunk, _encoding, callback) {
          bytes += chunk.length
          if (bytes > total) { callback(new MusicProviderError('INCOMPLETE_AUDIO', 'El tamaño recibido no coincide.', 422)); return }
          if (Date.now() - lastProgress > 350) { lastProgress = Date.now(); update(job.id, { bytes }) }
          callback(null, chunk)
        } })
        await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), progress, createWriteStream(raw), { signal })
        if (bytes !== total) throw new MusicProviderError('INCOMPLETE_AUDIO', 'La descarga quedó incompleta.', 422)
        update(job.id, { state: 'processing', bytes })
        const duration = await deps.prepare(raw, output, job.song, signal)
        const file = await stat(output), hash = await fileHash(output)
        if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new MusicProviderError('INVALID_AUDIO', 'El archivo preparado no es válido.', 422)
        const art = await deps.artwork(job.song).catch(() => ({ artwork: null, palette: ['#234d3b', '#273c4e', '#3e2849'] }))
        // Save lyrics for offline use before publishing. If lookup fails,
        // opening the lyrics later can complete them without repeating audio.
        await deps.lyrics(job.song, duration).catch(() => {})
        signal.throwIfAborted()
        await writeFile(marker, JSON.stringify({ assetId }))
        await rename(output, destination)
        try {
          db.transaction(() => {
            db.insert(assets).values({ id: assetId, filename: `${assetId}.m4a`, mime: 'audio/mp4', bytes: file.size, hash, variant: 'original' }).run()
            const audio = { videoId: job.videoId, assetId, duration, ...art, downloadedAt: Date.now() }
            db.insert(youtubeAudio).values(audio).onConflictDoUpdate({ target: youtubeAudio.videoId, set: audio }).run()
            update(job.id, { state: 'ready', bytes: file.size, total: file.size, error: null, errorCode: null })
          })
        } catch (error) { await rm(destination, { force: true }).catch(() => {}); throw error }
        sessionDiagnostic('audio.download', 'completed', { target: job.videoId, job: job.id, bytes: file.size, elapsedMs: Date.now() - began })
        notifyDesktop('libraryChanged')
        return
      } catch (error) {
        if (signal.aborted) throw error
        const retryable = (error as NodeJS.ErrnoException)?.code !== 'ENOSPC'
          && (!(error instanceof MusicProviderError) || error.statusCode >= 500 && error.code !== 'NO_SPACE')
        if (!retryable || attempt === 3) throw error
        await deps.wait(attempt === 1 ? 2000 : 10000, signal)
      } finally {
        await rm(raw, { force: true }).catch(() => {})
        await rm(output, { force: true }).catch(() => {})
      }
    }
  } catch (error) {
    const latest = db.select().from(audioDownloads).where(eq(audioDownloads.id, job.id)).get()
    if (latest?.suppressed) update(job.id, { state: 'cancelled', error: 'Descarga cancelada.', errorCode: 'CANCELLED' })
    else if (stopping) update(job.id, { state: 'queued', bytes: 0, error: null, errorCode: null })
    else if (signal.aborted) update(job.id, { state: 'cancelled', suppressed: true, error: 'Descarga cancelada.', errorCode: 'CANCELLED' })
    else {
      const code = error instanceof MusicProviderError ? error.code : (error as NodeJS.ErrnoException)?.code === 'ENOSPC' ? 'NO_SPACE' : 'DOWNLOAD_FAILED'
      const message = error instanceof MusicProviderError ? error.message : code === 'NO_SPACE' ? 'No hay espacio suficiente en el PC.' : 'No se pudo descargar. Comprueba la conexión y reintenta.'
      update(job.id, { state: 'failed', error: message, errorCode: code })
      logMusicFailure('download', job.videoId, error, { job: job.id })
      sessionDiagnostic('audio.download', 'failed', { target: job.videoId, job: job.id, code, elapsedMs: Date.now() - began })
    }
  } finally {
    if (!db.select().from(assets).where(eq(assets.id, assetId)).get()) await rm(destination, { force: true }).catch(() => {})
    await rm(marker, { force: true }).catch(() => {})
    active = undefined
  }
}
