import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import ffmpegPath from 'ffmpeg-static'
import { dataPaths, getDatabase } from '../database'
import { tracks, youtubeAudio, youtubeSongs } from '../database/schema'
import { AppleMotion, MotionProviderError, artistAlbumKey, motionMetadataKey, type AppleAlbumMetadata, type ArtistMotionSignature, type MotionKind, type MotionLookup, type MotionProvider, type MotionSignature } from './apple-motion'
import { diagnosticError, sessionDiagnostic } from './session-diagnostics'
import type { AlbumPresentation, Track, YouTubeSong } from '../../shared/types/music'

export interface MotionArt { key: string; path: string; bytes: number; width: number; height: number }
export type MotionResolution = { status: 'ready'; art: MotionArt } | { status: 'none' | 'unmatched'; retryAfterMs: number }
type MotionArtSignature = MotionSignature | ArtistMotionSignature
type CacheResolution = MotionResolution & { artistAlbumKeys?: string[]; albumCatalog?: AlbumCatalog }
interface Metadata { version: 1; resolverRevision?: number; status: 'ready' | 'none' | 'unmatched'; kind?: 'artist'; albumId?: number; albumIds?: number[]; artistId?: number; artistIds?: number[]; artistAlbumKeys?: string[]; bytes?: number; width?: number; height?: number; checkedAt: number; accessed: number }
interface CachedAlbumMetadata extends AppleAlbumMetadata { version: 1; fetchedAt?: number; retryAt?: number; albumId?: number }
interface AlbumCatalog { metadata?: CachedAlbumMetadata; lookup?: MotionLookup }
interface AlbumSelection { id?: number; retryAfterMs: number; load: () => Promise<AlbumCatalog> }
type VideoSize = Pick<MotionArt, 'width' | 'height'>
type Remux = (raw: string, output: string) => Promise<void | VideoSize>

const ABSENT_FOR = 30 * 24 * 3_600_000
const UNMATCHED_FOR = 24 * 3_600_000
const RETRY_AFTER = 15 * 60_000
const RESOLVER_REVISION = 2
const ALBUM_RESOLVER_REVISION = 3
const MAX_RETRY = 6 * 3_600_000
const ALBUM_METADATA_FOR = 7 * 24 * 3_600_000

function providerDelay(error: unknown) { return error instanceof MotionProviderError ? Math.max(RETRY_AFTER, error.retryAfterMs) : RETRY_AFTER }

/** Tests and isolated runs opt out of every request to the provider. */
export const motionArtEnabled = () => process.env.OPENFY_MOTION_ART !== 'off'

export function trackMotionSignature(track: Pick<Track, 'artist' | 'albumArtist' | 'album'>): MotionSignature | null {
  const artists = [track.albumArtist, track.artist].filter(name => name && name !== 'Artista desconocido')
  return motionSignature([...new Set(artists)], track.album === 'Sin álbum' ? null : track.album)
}
export const songMotionSignature = (song: Pick<YouTubeSong, 'artists' | 'album'>) => motionSignature(song.artists, song.album)
function motionSignature(artists: string[], album: string | null | undefined): MotionSignature | null {
  if (!album || !motionMetadataKey(album) || !artists[0] || !motionMetadataKey(artists[0])) return null
  return { artists, album }
}
/** An artist header belongs to the source profile and the release evidence used to identify it. */
export function motionKey(signature: MotionArtSignature) {
  const hash = createHash('sha256')
  if ('kind' in signature) {
    const albums = [...new Set(signature.albums.map(artistAlbumKey).filter(Boolean))].sort()
    return hash.update('artist\n' + JSON.stringify([signature.artistId ?? null, motionMetadataKey(signature.name), albums])).digest('hex')
  }
  const artist = motionMetadataKey(signature.artists[0]!)
  // Reserve the artist prefix even if an album is credited to an artist named "Artist".
  const prefix = artist === 'artist' ? 'album\nartist' : artist
  return hash.update(prefix + '\n' + motionMetadataKey(signature.album)).digest('hex')
}

function ffmpeg(args: string[], inspect = false) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.OPENFY_FFMPEG || ffmpegPath || 'ffmpeg', ['-hide_banner', '-loglevel', inspect ? 'info' : 'error', '-nostdin', '-nostats', ...args],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let failure: Error | undefined
    let details = ''
    child.stderr.on('data', chunk => { if (inspect && details.length < 16_384) details += chunk.toString() })
    child.on('error', error => { failure = error })
    child.on('close', code => failure ? reject(failure) : code === 0 ? resolve(details) : reject(new MotionProviderError('Motion video')))
  })
}
/** A plain, seekable MP4 without audio: both `<video loop>` and the Windows player restart it cleanly. */
export async function remuxMotion(raw: string, output: string, kind: MotionKind = 'album'): Promise<void | VideoSize> {
  await ffmpeg(['-y', '-i', raw, '-map', '0:v:0', '-an', '-c:v', 'copy', '-movflags', '+faststart', '-f', 'mp4', output])
  const details = await ffmpeg(['-xerror', '-i', output, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], kind === 'artist')
  if (kind === 'artist') {
    const size = /Stream #0:\d+[^:\r\n]*: Video:[^\r\n]*?, ([1-9]\d*)x([1-9]\d*)\b/.exec(details)
    if (!size) throw new MotionProviderError('Dimensiones del vídeo no disponibles')
    return { width: Number(size[1]), height: Number(size[2]) }
  }
}

/** One writer per key, atomic files, permanent album entries for the library and a budget for the rest. */
export class MotionCache {
  private pending = new Map<string, Promise<CacheResolution>>()
  private pendingAlbums = new Map<string, Promise<AlbumCatalog>>()
  private retry = new Map<string, number>()
  private failures = new Map<string, number>()
  private cleaning: Promise<void> = Promise.resolve()
  private lastCleanup = 0
  constructor(private root: string, private staging: string, private pins: () => Set<string>, private provider: MotionProvider,
    private remux?: Remux, private budget = 1024 ** 3, private now: () => number = Date.now) {}

  private async atomic(path: string, data: string) {
    const temporary = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temporary, data); await rename(temporary, path) }
    finally { await rm(temporary, { force: true }).catch(() => {}) }
  }
  private async metadata(key: string): Promise<Metadata | undefined> {
    try {
      const value = JSON.parse(await readFile(join(this.root, key, 'metadata.json'), 'utf8'))
      return value?.version === 1 && ['ready', 'none', 'unmatched'].includes(value.status)
        && Number.isFinite(value.checkedAt) && Number.isFinite(value.accessed) ? value : undefined
    } catch { return undefined }
  }

  private albumMetadataPath(key: string) {
    const store = this.provider.albumStorefront
    return join(this.root, key, `album-es-mx-en-us-${store && /^[a-z]{2}$/.test(store) ? store : 'default'}.json`)
  }

  private async readAlbumMetadata(key: string): Promise<CachedAlbumMetadata | undefined> {
    try {
      const value = JSON.parse(await readFile(this.albumMetadataPath(key), 'utf8'))
      return value?.version === 1 && (Number.isFinite(value.fetchedAt) || Number.isFinite(value.retryAt)) ? value : undefined
    } catch { return undefined }
  }

  private albumRetry(metadata: CachedAlbumMetadata | undefined) {
    return Math.max(0, (metadata?.retryAt ?? 0) - this.now())
  }

  private async refreshAlbum(signature: MotionSignature, key: string, needSource: boolean): Promise<AlbumCatalog> {
    const pending = this.pendingAlbums.get(key)
    if (pending) {
      const result = await pending
      if (!needSource || result.lookup || this.albumRetry(result.metadata) || !motionArtEnabled()) return result
      return this.refreshAlbum(signature, key, true)
    }
    const work = (async (): Promise<AlbumCatalog> => {
      const previous = await this.readAlbumMetadata(key)
      if (!motionArtEnabled() || this.albumRetry(previous)) return { metadata: previous }
      const ttl = previous?.editorial || previous?.colors ? ALBUM_METADATA_FOR : UNMATCHED_FOR
      if (!needSource && previous?.fetchedAt !== undefined && previous.fetchedAt + ttl > this.now()) return { metadata: previous }

      let lookup: MotionLookup | undefined, metadata: CachedAlbumMetadata
      try {
        // Revalidate the search after TTL expiry. A video request for a fresh album can go straight to its selected ID.
        const albumIdHint = previous?.fetchedAt !== undefined && previous.fetchedAt + ttl > this.now() ? previous.albumId : undefined
        lookup = await this.provider.find(signature, albumIdHint)
        const now = this.now()
        if (lookup.status === 'unmatched') metadata = { version: 1, fetchedAt: now }
        else {
          const albumId = lookup.status === 'ready' ? lookup.source.albumId : lookup.albumIds[0]
          const retryAt = lookup.metadataRetryAfterMs ? now + Math.max(RETRY_AFTER, lookup.metadataRetryAfterMs) : undefined
          const stale = retryAt && previous?.albumId === albumId ? previous : undefined
          metadata = { version: 1, albumId, fetchedAt: retryAt ? stale?.fetchedAt : now, retryAt,
            editorial: lookup.editorial ?? stale?.editorial, colors: lookup.colors ?? stale?.colors }
        }
      } catch (error) {
        metadata = { ...previous, version: 1, retryAt: this.now() + providerDelay(error) }
      }
      // A cache write failure must not discard the valid provider response.
      await mkdir(join(this.root, key), { recursive: true }).then(() => this.atomic(this.albumMetadataPath(key), JSON.stringify(metadata))).catch(() => {})
      return { metadata, lookup }
    })().finally(() => { this.pendingAlbums.delete(key) })
    this.pendingAlbums.set(key, work)
    return work
  }

  async albumPresentation(signature: MotionSignature, { motion }: { motion: boolean }): Promise<{ presentation: AlbumPresentation; retryAfterMs: number }> {
    const key = motionKey(signature)
    let catalog = await this.refreshAlbum(signature, key, false)
    const presentation: AlbumPresentation = { motion: { status: 'none' } }
    let motionRetryAfterMs = 0
    if (motion) {
      const selected = catalog.metadata
      if (selected?.fetchedAt !== undefined && selected.albumId === undefined && !this.albumRetry(selected)) {
        presentation.motion = { status: 'unmatched', retryAfterMs: Math.max(0, selected.fetchedAt + UNMATCHED_FOR - this.now()) }
      } else {
        try {
          const result = await this.lookupMotion(signature, { id: selected?.albumId, retryAfterMs: catalog.lookup ? 0 : this.albumRetry(selected), load: async () => {
            if (!catalog.lookup) catalog = await this.refreshAlbum(signature, key, true)
            return catalog
          } })
          catalog = result.albumCatalog ?? catalog
          presentation.motion = result.status === 'ready'
            ? { status: 'ready', url: `/api/motion/${result.art.key}.mp4`, width: result.art.width, height: result.art.height }
            : { status: result.status, retryAfterMs: result.retryAfterMs }
        } catch (error) {
          motionRetryAfterMs = error instanceof MotionProviderError ? error.retryAfterMs : RETRY_AFTER
          presentation.motion = { status: 'none', retryAfterMs: motionRetryAfterMs }
        }
      }
    }
    const { editorial, colors } = catalog.metadata ?? {}
    if (editorial) presentation.description = { text: editorial, source: 'apple' }
    if (colors) presentation.colors = colors
    return { presentation, retryAfterMs: Math.max(this.albumRetry(catalog.metadata), motionRetryAfterMs) }
  }

  private async ready(key: string, meta: Metadata | undefined): Promise<MotionArt | null> {
    if (meta?.status !== 'ready' || !meta.bytes || !meta.width || !meta.height) return null
    const path = join(this.root, key, 'motion.mp4')
    try { if ((await stat(path)).size !== meta.bytes) return null } catch { return null }
    return { key, path, bytes: meta.bytes!, width: meta.width!, height: meta.height! }
  }

  /** The stored file for a key, for the route that serves it. */
  async file(key: string) { return /^[a-f0-9]{64}$/.test(key) ? this.ready(key, await this.metadata(key)) : null }
  private async keys() { return (await readdir(this.root).catch(() => [] as string[])).filter(name => /^[a-f0-9]{64}$/.test(name)) }
  private expires(meta: Metadata | undefined) {
    if (meta?.resolverRevision !== (meta?.kind === 'artist' ? RESOLVER_REVISION : ALBUM_RESOLVER_REVISION)) return 0
    return meta.status === 'none' ? meta.checkedAt + ABSENT_FOR : meta.status === 'unmatched' ? meta.checkedAt + UNMATCHED_FOR : 0
  }
  /** Infinity means a valid video; zero means it needs a lookup, not merely a folder on disk. */
  async nextAttempt(key: string) {
    const meta = await this.metadata(key)
    return await this.ready(key, meta) ? Infinity : Math.max(this.expires(meta), this.retry.get(key) || 0)
  }
  async schedule() {
    const keys = await this.keys(), result = new Map<string, number>()
    for (let start = 0; start < keys.length; start += 16) {
      await Promise.all(keys.slice(start, start + 16).map(async key => result.set(key, await this.nextAttempt(key))))
    }
    return result
  }

  /** Convenience for callers that only need the stored file. */
  async resolve(signature: MotionArtSignature): Promise<MotionArt | null> {
    const result = await this.lookup(signature)
    return result.status === 'ready' ? result.art : null
  }

  /** Distinguishes a verified absence from a search without a confirmed match. */
  async lookup(signature: MotionArtSignature): Promise<MotionResolution> {
    const result = await this.lookupMotion(signature)
    return result.status === 'ready' ? { status: 'ready', art: result.art } : { status: result.status, retryAfterMs: result.retryAfterMs }
  }

  private async lookupMotion(signature: MotionArtSignature, album?: AlbumSelection): Promise<CacheResolution> {
    const albums = 'kind' in signature ? new Set(signature.albums.map(artistAlbumKey).filter(Boolean)) : undefined
    const unmatched = { status: 'unmatched', retryAfterMs: UNMATCHED_FOR } as const
    if (albums?.size === 0) return unmatched
    // A name can identify several artists. Require album overlap even when reusing a video.
    const verified = (keys: string[] | undefined) => !albums || keys?.some(key => albums.has(key))
    const key = motionKey(signature), stored = await this.metadata(key)
    const sameAlbum = album?.id === undefined || stored?.albumId === album.id || stored?.albumIds?.includes(album.id)
    const meta = sameAlbum && stored?.kind === ('kind' in signature ? signature.kind : undefined) ? stored : undefined
    const existing = await this.ready(key, meta)
    if (existing) {
      if (!verified(meta?.artistAlbumKeys)) return unmatched
      if (this.now() - meta!.accessed > 60_000) await this.atomic(join(this.root, key, 'metadata.json'), JSON.stringify({ ...meta, accessed: this.now() })).catch(() => {})
      return { status: 'ready', art: existing }
    }
    const expires = this.expires(meta)
    if (expires > this.now() && (meta?.status === 'none' || meta?.status === 'unmatched')) return { status: meta.status, retryAfterMs: expires - this.now() }
    if (!motionArtEnabled()) return unmatched
    const retryAfterMs = Math.max(album?.retryAfterMs ?? 0, (this.retry.get(key) ?? 0) - this.now())
    if (retryAfterMs > 0) throw new MotionProviderError('Motion retry later', retryAfterMs)
    let work = this.pending.get(key)
    if (!work) {
      work = this.fetch(signature, key, album)
      this.pending.set(key, work)
      void work.catch(() => {}).finally(() => {
        if (this.pending.get(key) === work) this.pending.delete(key)
        if (this.now() - this.lastCleanup > 60_000) { this.lastCleanup = this.now(); void this.prune().catch(() => {}) }
      })
    }
    const result = await work
    if (result.status !== 'ready') return result
    return verified(result.artistAlbumKeys) ? result : unmatched
  }

  private async fetch(signature: MotionArtSignature, key: string, album?: AlbumSelection): Promise<CacheResolution> {
    const started = performance.now(), target = key.slice(0, 12)
    const raw = join(this.staging, `${key}.motion.part`), output = join(this.staging, `${key}.motion.mp4`)
    sessionDiagnostic('motion.resolve', 'started', { target })
    try {
      const directory = join(this.root, key)
      const artist = 'kind' in signature
      const kind = artist ? { kind: 'artist' as const } : {}
      const resolverRevision = artist ? RESOLVER_REVISION : ALBUM_RESOLVER_REVISION
      const catalog = artist ? undefined : await (album?.load() ?? this.refreshAlbum(signature, key, true))
      const lookup = artist ? await this.provider.findArtist?.(signature) : catalog?.lookup
      if (!lookup) throw new MotionProviderError(artist ? 'Proveedor de vídeo de artista no disponible' : 'La portada animada no está disponible ahora.',
        this.albumRetry(catalog?.metadata) || RETRY_AFTER)
      if ('motionRetryAfterMs' in lookup && lookup.motionRetryAfterMs) throw new MotionProviderError('El vídeo del álbum no está disponible ahora.', lookup.motionRetryAfterMs)
      if (!motionArtEnabled()) return { status: 'unmatched', retryAfterMs: UNMATCHED_FOR }
      const now = this.now()
      if (lookup.status !== 'ready') {
        await mkdir(directory, { recursive: true })
        await rm(join(directory, 'motion.mp4'), { force: true }).catch(() => {})
        await this.atomic(join(directory, 'metadata.json'), JSON.stringify({ version: 1, resolverRevision,
          status: lookup.status, ...kind, ...('albumIds' in lookup ? { albumIds: lookup.albumIds } : {}),
          ...('artistIds' in lookup ? { artistIds: lookup.artistIds } : {}), checkedAt: now, accessed: now } satisfies Metadata))
        this.retry.delete(key); this.failures.delete(key)
        const retryAfterMs = lookup.status === 'none' ? ABSENT_FOR : UNMATCHED_FOR
        sessionDiagnostic('motion.resolve', lookup.status, { target, retryAfterMs, elapsedMs: Math.round(performance.now() - started) })
        return { status: lookup.status, retryAfterMs, albumCatalog: catalog }
      }
      const source = lookup.source
      await mkdir(this.staging, { recursive: true })
      const rendition = artist ? await this.provider.download(source.master, raw, undefined, 'artist') : await this.provider.download(source.master, raw)
      const measured = this.remux ? await this.remux(raw, output) : await remuxMotion(raw, output, artist ? 'artist' : 'album')
      const size = measured || rendition
      const bytes = (await stat(output)).size
      if (!bytes) throw new MotionProviderError('Motion empty')
      await mkdir(directory, { recursive: true })
      await rename(output, join(directory, 'motion.mp4'))
      const identity = 'artistId' in source ? { artistId: source.artistId, artistAlbumKeys: source.albumKeys } : { albumId: source.albumId }
      await this.atomic(join(directory, 'metadata.json'), JSON.stringify({ version: 1, resolverRevision,
        status: 'ready', ...kind, ...identity, bytes, ...size, checkedAt: now, accessed: now } satisfies Metadata))
      this.retry.delete(key); this.failures.delete(key)
      sessionDiagnostic('motion.resolve', 'ready', { target, bytes, elapsedMs: Math.round(performance.now() - started) })
      return { status: 'ready', art: { key, path: join(directory, 'motion.mp4'), bytes, ...size }, artistAlbumKeys: identity.artistAlbumKeys, albumCatalog: catalog }
    } catch (error) {
      const failures = (this.failures.get(key) || 0) + 1
      this.failures.set(key, failures)
      const retryAfterMs = Math.max(error instanceof MotionProviderError ? error.retryAfterMs : 0, Math.min(MAX_RETRY, RETRY_AFTER * 2 ** Math.min(failures - 1, 5)))
      this.retry.set(key, this.now() + retryAfterMs)
      const { errorType, code } = diagnosticError(error)
      sessionDiagnostic('motion.resolve', 'failed', { target, retryAfterMs, errorType, code, elapsedMs: Math.round(performance.now() - started) })
      throw new MotionProviderError(error instanceof MotionProviderError ? error.message : 'Motion storage', retryAfterMs)
    } finally {
      await rm(raw, { force: true }).catch(() => {})
      await rm(output, { force: true }).catch(() => {})
    }
  }

  /** Evicts the least recently shown videos outside the library once they exceed the budget. */
  prune(): Promise<void> {
    const removeMotion = async (key: string) => {
      if (this.pending.has(key)) return false
      const directory = join(this.root, key)
      await rm(join(directory, 'motion.mp4'), { force: true }).catch(() => {})
      await rm(join(directory, 'metadata.json'), { force: true }).catch(() => {})
      if (!this.pendingAlbums.has(key)) await rmdir(directory).catch(() => {})
      return true
    }
    const clean = async () => {
      const pinned = this.pins() // If the library cannot be read, do not evict anything.
      const candidates: { key: string; bytes: number; accessed: number }[] = []
      for (const key of await this.keys()) {
        if (this.pending.has(key)) continue
        const meta = await this.metadata(key)
        if (!meta || (meta.kind !== 'artist' && pinned.has(key))) continue
        if (meta.status !== 'ready') { if (this.expires(meta) <= this.now()) await removeMotion(key) }
        else candidates.push({ key, bytes: meta.bytes || 0, accessed: meta.accessed })
      }
      let total = candidates.reduce((sum, item) => sum + item.bytes, 0)
      for (const item of candidates.sort((a, b) => a.accessed - b.accessed)) {
        if (total <= this.budget) break
        if (this.now() - item.accessed < 120_000 || this.pending.has(item.key)) continue
        if (await removeMotion(item.key)) total -= item.bytes
      }
    }
    this.cleaning = this.cleaning.catch(() => {}).then(clean)
    return this.cleaning
  }
}

/** Albums kept for good: the local library and every song downloaded to this PC. */
export function pinnedMotion() {
  const db = getDatabase(), pinned = new Map<string, MotionSignature>()
  const add = (signature: MotionSignature | null) => { if (signature) pinned.set(motionKey(signature), signature) }
  for (const row of db.select({ metadata: tracks.metadata }).from(tracks).all()) add(trackMotionSignature(row.metadata))
  for (const row of db.select({ song: youtubeSongs.song }).from(youtubeAudio).innerJoin(youtubeSongs, eq(youtubeSongs.videoId, youtubeAudio.videoId)).all()) add(songMotionSignature(row.song))
  return pinned
}

let cache: MotionCache | undefined, cacheRoot = ''
export function motionCache() {
  const paths = dataPaths()
  if (!cache || cacheRoot !== paths.root) {
    cacheRoot = paths.root
    cache = new MotionCache(join(paths.root, 'motion-cache'), paths.staging, () => new Set(pinnedMotion().keys()), new AppleMotion())
  }
  return cache
}
export function setMotionCache(next: MotionCache | undefined) { cache = next; cacheRoot = next ? dataPaths().root : ''; resetMotionArtQueue() }

/**
 * Background completion for the pinned albums, one at a time and unhurried.
 * Stored deadlines wake the queue again even if the library never changes.
 */
const SPACING = 6000
let readyAt = 0, failures = 0
let queueAlbums: Map<string, MotionSignature> | undefined
let dueTimes: Map<string, number> | undefined
let queueGeneration = 0

/** The library changed: read the stored answers again, since an evicted album may now be pinned. */
export function motionArtChanged() { queueGeneration++; queueAlbums = undefined; dueTimes = undefined }
export function resetMotionArtQueue() { motionArtChanged(); readyAt = 0; failures = 0 }

function nextMotionArt(now: number) {
  if (!dueTimes) return undefined
  for (const [key, signature] of queueAlbums ||= pinnedMotion()) {
    if ((dueTimes.get(key) || 0) <= now) return { key, signature }
  }
}

/** Milliseconds until the next album can be looked up, or null when none is waiting. */
export function motionArtDelay(now = Date.now()) {
  if (!motionArtEnabled()) return null
  // The first call only knows the directory listing once it has been read.
  if (!dueTimes) return Math.max(0, readyAt - now)
  let next = Infinity
  for (const key of (queueAlbums ||= pinnedMotion()).keys()) next = Math.min(next, dueTimes.get(key) ?? 0)
  return Number.isFinite(next) ? Math.max(0, Math.max(next, readyAt) - now) : null
}

export async function completeNextMotionArt(now = Date.now) {
  const store = motionCache()
  const generation = queueGeneration
  if (!dueTimes) {
    const schedule = await store.schedule()
    if (generation !== queueGeneration) return
    dueTimes = schedule
  }
  if (now() < readyAt || !motionArtEnabled()) return
  const next = nextMotionArt(now())
  if (!next) return
  readyAt = now() + SPACING
  try {
    await store.lookup(next.signature)
    if (generation !== queueGeneration) return
    failures = 0
    readyAt = now() + SPACING
  } catch {
    // Offline or a changed provider: leave this album for later and slow down, never loop.
    if (generation !== queueGeneration) return
    failures++
    readyAt = now() + Math.min(MAX_RETRY, RETRY_AFTER * 2 ** Math.min(failures - 1, 5))
  }
  const due = await store.nextAttempt(next.key)
  if (generation === queueGeneration) dueTimes?.set(next.key, due)
}
