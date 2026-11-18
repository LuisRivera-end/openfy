import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { dataPaths, getDatabase } from '../database'
import { playlists, tracks, youtubeAudio, youtubeSongs } from '../database/schema'
import { eq } from 'drizzle-orm'
import { artworkIdentity, artworkSize, isVideoThumbnail, largeArtworkUrl } from '../../shared/utils/artwork'
import { diagnosticError, diagnosticTarget, sessionDiagnostic } from './session-diagnostics'
import { squareVideoFrame } from './video-artwork'

export interface PreparedArtwork { path: string; palette: string[]; width: number; height: number; key: string }
interface Metadata { source: string; palette: string[]; width: number; height: number; accessed: number; retryAfter?: number; version?: number }
/** v3 preserves dark video artwork; other v2 sources remain usable offline. */
const CACHE_VERSION = 3
export function validArtwork(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4000) throw new Error('Portada no válida.')
  if (/^\/api\/artwork\/[a-f0-9]{64}\.webp$/.test(value)) return value
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/(^|\.)(googleusercontent\.com|ytimg\.com|ggpht\.com)$/.test(url.hostname)) throw new Error('Proveedor de portada no válido.')
  return value
}
export const artworkKey = (source: string) => createHash('sha256').update(artworkIdentity(source)).digest('hex')

/** One writer per source, atomic files, and serialized best-effort eviction. */
export class ArtworkCache {
  private pending = new Map<string, Promise<PreparedArtwork>>()
  private evicting = new Map<string, Promise<void>>()
  private sources = new Map<string, Promise<Metadata>>()
  private touched = new Map<string, number>()
  private cleaning: Promise<void> = Promise.resolve()
  private lastCleanup = 0
  constructor(private root: string, private originals: string,
    private pins: () => Set<string>, private download: typeof fetch = fetch,
    private budget = 256 * 1024 ** 2) {}

  async prepare(value: unknown, requested: unknown = 1024): Promise<PreparedArtwork> {
    const source = validArtwork(value), key = artworkKey(source), size = artworkSize(requested), token = `${key}:${size}`
    const removal = this.evicting.get(key)
    if (removal) await removal
    const existing = this.pending.get(token)
    if (existing) return existing
    const work = this.prepareCore(source, key, size)
    this.pending.set(token, work)
    try { return await work } finally {
      if (this.pending.get(token) === work) this.pending.delete(token)
      if (Date.now() - this.lastCleanup > 60_000) { this.lastCleanup = Date.now(); void this.prune().catch(() => {}) }
    }
  }
  private async atomic(path: string, data: Buffer | string) {
    const temporary = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temporary, data); await rename(temporary, path) }
    finally { await rm(temporary, { force: true }).catch(() => {}) }
  }
  private async fetchImage(url: string) {
    const response = await this.download(url, { redirect: 'error', signal: AbortSignal.timeout(12_000) })
    if (!response.ok || !response.body) throw new Error(`No se pudo obtener la portada (HTTP ${response.status}).`)
    const reader = response.body.getReader(), parts: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break
        bytes += part.value.length
        if (bytes > 8 * 1024 ** 2) throw new Error('Portada demasiado grande.')
        parts.push(part.value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const buffer = Buffer.concat(parts)
    await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata()
    return buffer
  }
  private async source(source: string, key: string): Promise<Metadata> {
    const directory = join(this.root, key), file = join(directory, 'source.webp'), metaFile = join(directory, 'metadata.json')
    let previous: Metadata | undefined
    try {
      previous = JSON.parse(await readFile(metaFile, 'utf8'))
      await stat(file)
      // An entry from an older cache version refreshes once; if offline it keeps serving for the retry window.
      const retry = previous!.retryAfter, waiting = !!retry && retry > Date.now()
      const compatible = previous!.version === CACHE_VERSION || (previous!.version === 2 && !isVideoThumbnail(source))
      if (compatible ? !retry || waiting : waiting) return previous!
    } catch { previous = undefined }
    await mkdir(directory, { recursive: true })
    let input: Buffer | string, fallback = false
    try {
      if (source.startsWith('/api/artwork/')) input = join(this.originals, basename(source))
      else {
        const large = largeArtworkUrl(source)
        try { input = await this.fetchImage(large) }
        catch (error) {
          const keep = async () => { previous!.retryAfter = Date.now() + 300_000; await this.atomic(metaFile, JSON.stringify(previous)); return previous! }
          // A missing maxres video frame is permanent, so an old letterboxed entry still upgrades from the regular frame.
          const video = isVideoThumbnail(source)
          if (previous && (previous.version === CACHE_VERSION || !video)) return keep()
          if (large === source) { if (previous) return keep(); throw error }
          try { input = await this.fetchImage(source); fallback = !video }
          catch (failure) { if (previous) return keep(); throw failure }
        }
      }
    } catch (error) {
      // Preserve the old desktop cache as an offline fallback during migration.
      const legacy = join(this.root, '..', 'desktop-artwork', createHash('sha256').update(source).digest('hex') + '.png')
      if (previous) return previous
      try { await stat(legacy); input = legacy; fallback = true } catch { throw error }
    }
    let bytes = typeof input === 'string' ? await readFile(input) : input
    if (isVideoThumbnail(source)) bytes = await squareVideoFrame(bytes)
    const image = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
    const { width = 1, height = 1 } = await image.metadata()
    const limit = width >= height * 1.5 ? 2048 : 1024
    const { data } = await image.clone().resize(3, 1, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
    const { data: master, info } = await image.resize(limit, limit, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 92 }).toBuffer({ resolveWithObject: true })
    const meta: Metadata = { source, palette: Array.from({ length: 3 }, (_, i) => '#' + data.subarray(i * 3, i * 3 + 3).toString('hex')), width: info.width, height: info.height, accessed: Date.now(), version: CACHE_VERSION, ...(fallback ? { retryAfter: Date.now() + 300_000 } : {}) }
    await this.atomic(file, master)
    // Dimension in the variant filename prevents a stale decode after upgrading a fallback.
    await this.atomic(metaFile, JSON.stringify(meta))
    return meta
  }
  private async prepareCore(source: string, key: string, size: number): Promise<PreparedArtwork> {
    const start = performance.now(), target = diagnosticTarget(source)
    this.touched.set(key, Date.now())
    sessionDiagnostic('artwork.prepare', 'started', { target })
    try {
      let work = this.sources.get(key)
      if (!work) { work = this.source(source, key); this.sources.set(key, work) }
      let meta: Metadata
      try { meta = await work } finally { if (this.sources.get(key) === work) this.sources.delete(key) }
      const path = join(this.root, key, `v${CACHE_VERSION}-${size}-${meta.width}x${meta.height}.png`)
      try { await stat(path); sessionDiagnostic('artwork.cache', 'hit', { target }) }
      catch {
        sessionDiagnostic('artwork.cache', 'miss', { target })
        const data = await sharp(await readFile(join(this.root, key, 'source.webp'))).resize(size, size, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
        await this.atomic(path, data)
      }
      if (Date.now() - meta.accessed > 60_000) {
        meta.accessed = Date.now(); await this.atomic(join(this.root, key, 'metadata.json'), JSON.stringify(meta))
      }
      const scale = Math.min(1, size / Math.max(meta.width, meta.height))
      sessionDiagnostic('artwork.prepare', 'completed', { target, cacheFile: path, elapsedMs: Math.round(performance.now() - start) })
      return { path, palette: meta.palette, key, width: Math.round(meta.width * scale), height: Math.round(meta.height * scale) }
    } catch (error) { sessionDiagnostic('artwork.prepare', 'failed', { target, ...diagnosticError(error) }); throw error }
  }
  prune(): Promise<void> {
    const clean = async () => {
      const pinned = this.pins() // If the library cannot be read, do not evict anything.
      const candidates: { key: string; bytes: number; accessed: number }[] = []
      for (const key of await readdir(this.root).catch(() => [] as string[])) {
        if (!/^[a-f0-9]{64}$/.test(key) || pinned.has(key)) continue
        try {
          const meta: Metadata = JSON.parse(await readFile(join(this.root, key, 'metadata.json'), 'utf8'))
          let bytes = 0
          for (const file of await readdir(join(this.root, key))) bytes += (await stat(join(this.root, key, file))).size
          candidates.push({ key, bytes, accessed: Math.max(meta.accessed, this.touched.get(key) || 0) })
        } catch { /* A partial cache entry is recoverable on its next request. */ }
      }
      let total = candidates.reduce((sum, item) => sum + item.bytes, 0)
      for (const item of candidates.sort((a, b) => a.accessed - b.accessed)) {
        if (total <= this.budget) break
        if (Date.now() - Math.max(item.accessed, this.touched.get(item.key) || 0) < 120_000 || this.sources.has(item.key) || [...this.pending.keys()].some(k => k.startsWith(item.key + ':'))) continue
        const removal = rm(join(this.root, item.key), { recursive: true, force: true })
        this.evicting.set(item.key, removal)
        try { await removal } finally { this.evicting.delete(item.key) }
        this.touched.delete(item.key); total -= item.bytes
      }
    }
    this.cleaning = this.cleaning.catch(() => {}).then(clean)
    return this.cleaning
  }
}
let cache: ArtworkCache | undefined, cacheRoot = ''
/** Stale queues and catalog views can still carry the original provider URL. */
export async function prepareArtwork(value: unknown, requested: unknown = 1024) {
  let source = validArtwork(value)
  if (!source.startsWith('/api/artwork/')) {
    const identity = artworkIdentity(source)
    const matches = getDatabase().select({ song: youtubeSongs.song, artwork: youtubeAudio.artwork }).from(youtubeAudio)
      .innerJoin(youtubeSongs, eq(youtubeSongs.videoId, youtubeAudio.videoId)).all()
      .filter(row => row.song.artwork && artworkIdentity(row.song.artwork) === identity)
    if (matches.length) {
      const local = matches.find(row => row.artwork)?.artwork
      if (!local) throw new Error('La canción descargada no tiene una portada local.')
      source = local
    }
  }
  return artworkCache().prepare(source, requested)
}
export function artworkCache() {
  const paths = dataPaths()
  if (!cache || cacheRoot !== paths.root) {
    cacheRoot = paths.root
    cache = new ArtworkCache(join(paths.root, 'artwork-cache'), paths.artwork, () => {
      const db = getDatabase(), pinned = new Set<string>()
      const ids = new Set(db.select().from(playlists).all().flatMap(p => p.trackIds))
      for (const track of db.select({ metadata: tracks.metadata }).from(tracks).all()) if (track.metadata.artwork) pinned.add(artworkKey(track.metadata.artwork))
      for (const saved of db.select().from(youtubeSongs).all()) if ((saved.favorite || ids.has('youtube:' + saved.videoId)) && saved.song.artwork) pinned.add(artworkKey(saved.song.artwork))
      return pinned
    })
  }
  return cache
}
