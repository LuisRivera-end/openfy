import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import ffmpegPath from 'ffmpeg-static'
import { dataPaths, getDatabase } from '../database'
import { tracks, youtubeAudio, youtubeSongs } from '../database/schema'
import { AppleMotion, MotionProviderError, motionMetadataKey, type MotionProvider, type MotionSignature } from './apple-motion'
import { diagnosticError, sessionDiagnostic } from './session-diagnostics'
import type { Track, YouTubeSong } from '../../shared/types/music'

export interface MotionArt { key: string; path: string; bytes: number; width: number; height: number }
export type MotionResolution = { status: 'ready'; art: MotionArt } | { status: 'none' | 'unmatched'; retryAfterMs: number }
interface Metadata { version: 1; resolverRevision?: number; status: 'ready' | 'none' | 'unmatched'; albumId?: number; albumIds?: number[]; bytes?: number; width?: number; height?: number; checkedAt: number; accessed: number }
type Remux = (raw: string, output: string) => Promise<void>

const ABSENT_FOR = 30 * 24 * 3_600_000
const UNMATCHED_FOR = 24 * 3_600_000
const RETRY_AFTER = 15 * 60_000
const RESOLVER_REVISION = 2
const MAX_RETRY = 6 * 3_600_000

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
/** One entry per album of a main artist, however its songs credit their guests. */
export const motionKey = (signature: MotionSignature) =>
  createHash('sha256').update(`${motionMetadataKey(signature.artists[0]!)}\n${motionMetadataKey(signature.album)}`).digest('hex')

function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.OPENFY_FFMPEG || ffmpegPath || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let failure: Error | undefined
    child.stderr.on('data', () => {})
    child.on('error', error => { failure = error })
    child.on('close', code => failure ? reject(failure) : code === 0 ? resolve() : reject(new MotionProviderError('Motion video')))
  })
}
/** A plain, seekable MP4 without audio: both `<video loop>` and the Windows player restart it cleanly. */
export async function remuxMotion(raw: string, output: string) {
  await ffmpeg(['-y', '-i', raw, '-map', '0:v:0', '-an', '-c:v', 'copy', '-movflags', '+faststart', '-f', 'mp4', output])
  await ffmpeg(['-xerror', '-i', output, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'])
}

/** One writer per album, atomic files, permanent entries for the library and a budget for the rest. */
export class MotionCache {
  private pending = new Map<string, Promise<MotionResolution>>()
  private retry = new Map<string, number>()
  private failures = new Map<string, number>()
  private cleaning: Promise<void> = Promise.resolve()
  private lastCleanup = 0
  constructor(private root: string, private staging: string, private pins: () => Set<string>, private provider: MotionProvider,
    private remux: Remux = remuxMotion, private budget = 1024 ** 3, private now: () => number = Date.now) {}

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
    if (meta?.resolverRevision !== RESOLVER_REVISION) return 0
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
  async resolve(signature: MotionSignature): Promise<MotionArt | null> {
    const result = await this.lookup(signature)
    return result.status === 'ready' ? result.art : null
  }

  /** Distinguishes a verified absence from an album that neither search could resolve. */
  async lookup(signature: MotionSignature): Promise<MotionResolution> {
    const key = motionKey(signature), meta = await this.metadata(key), existing = await this.ready(key, meta)
    if (existing) {
      if (this.now() - meta!.accessed > 60_000) await this.atomic(join(this.root, key, 'metadata.json'), JSON.stringify({ ...meta, accessed: this.now() })).catch(() => {})
      return { status: 'ready', art: existing }
    }
    const expires = this.expires(meta)
    if (expires > this.now() && (meta?.status === 'none' || meta?.status === 'unmatched')) return { status: meta.status, retryAfterMs: expires - this.now() }
    if (!motionArtEnabled()) return { status: 'unmatched', retryAfterMs: UNMATCHED_FOR }
    const retry = this.retry.get(key) || 0
    if (retry > this.now()) throw new MotionProviderError('Motion retry later', retry - this.now())
    let work = this.pending.get(key)
    if (!work) {
      work = this.fetch(signature, key)
      this.pending.set(key, work)
      void work.catch(() => {}).finally(() => {
        if (this.pending.get(key) === work) this.pending.delete(key)
        if (this.now() - this.lastCleanup > 60_000) { this.lastCleanup = this.now(); void this.prune().catch(() => {}) }
      })
    }
    return work
  }

  private async fetch(signature: MotionSignature, key: string): Promise<MotionResolution> {
    const started = performance.now(), target = key.slice(0, 12)
    const raw = join(this.staging, `${key}.motion.part`), output = join(this.staging, `${key}.motion.mp4`)
    sessionDiagnostic('motion.resolve', 'started', { target })
    try {
      const directory = join(this.root, key)
      const lookup = await this.provider.find(signature), now = this.now()
      if (lookup.status !== 'ready') {
        await mkdir(directory, { recursive: true })
        await rm(join(directory, 'motion.mp4'), { force: true }).catch(() => {})
        await this.atomic(join(directory, 'metadata.json'), JSON.stringify({ version: 1, resolverRevision: RESOLVER_REVISION,
          status: lookup.status, ...('albumIds' in lookup ? { albumIds: lookup.albumIds } : {}), checkedAt: now, accessed: now } satisfies Metadata))
        this.retry.delete(key); this.failures.delete(key)
        const retryAfterMs = lookup.status === 'none' ? ABSENT_FOR : UNMATCHED_FOR
        sessionDiagnostic('motion.resolve', lookup.status, { target, retryAfterMs, elapsedMs: Math.round(performance.now() - started) })
        return { status: lookup.status, retryAfterMs }
      }
      const source = lookup.source
      await mkdir(this.staging, { recursive: true })
      const size = await this.provider.download(source.master, raw)
      await this.remux(raw, output)
      const bytes = (await stat(output)).size
      if (!bytes) throw new MotionProviderError('Motion empty')
      await mkdir(directory, { recursive: true })
      await rename(output, join(directory, 'motion.mp4'))
      await this.atomic(join(directory, 'metadata.json'), JSON.stringify({ version: 1, resolverRevision: RESOLVER_REVISION, status: 'ready', albumId: source.albumId, bytes, ...size, checkedAt: now, accessed: now } satisfies Metadata))
      this.retry.delete(key); this.failures.delete(key)
      sessionDiagnostic('motion.resolve', 'ready', { target, bytes, elapsedMs: Math.round(performance.now() - started) })
      return { status: 'ready', art: { key, path: join(directory, 'motion.mp4'), bytes, ...size } }
    } catch (error) {
      const failures = (this.failures.get(key) || 0) + 1
      this.failures.set(key, failures)
      const retryAfterMs = Math.min(MAX_RETRY, RETRY_AFTER * 2 ** Math.min(failures - 1, 5))
      this.retry.set(key, this.now() + retryAfterMs)
      sessionDiagnostic('motion.resolve', 'failed', { target, retryAfterMs, ...diagnosticError(error), elapsedMs: Math.round(performance.now() - started) })
      throw new MotionProviderError(error instanceof MotionProviderError ? error.message : 'Motion storage', retryAfterMs)
    } finally {
      await rm(raw, { force: true }).catch(() => {})
      await rm(output, { force: true }).catch(() => {})
    }
  }

  /** Evicts the least recently shown videos outside the library once they exceed the budget. */
  prune(): Promise<void> {
    const clean = async () => {
      const pinned = this.pins() // If the library cannot be read, do not evict anything.
      const candidates: { key: string; bytes: number; accessed: number }[] = []
      for (const key of await this.keys()) {
        if (pinned.has(key) || this.pending.has(key)) continue
        const meta = await this.metadata(key)
        if (!meta) continue
        if (meta.status !== 'ready') { if (this.expires(meta) <= this.now()) await rm(join(this.root, key), { recursive: true, force: true }).catch(() => {}) }
        else candidates.push({ key, bytes: meta.bytes || 0, accessed: meta.accessed })
      }
      let total = candidates.reduce((sum, item) => sum + item.bytes, 0)
      for (const item of candidates.sort((a, b) => a.accessed - b.accessed)) {
        if (total <= this.budget) break
        if (this.now() - item.accessed < 120_000 || this.pending.has(item.key)) continue
        await rm(join(this.root, item.key), { recursive: true, force: true }).catch(() => {})
        total -= item.bytes
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
