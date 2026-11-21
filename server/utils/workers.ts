import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import ffmpegPath from 'ffmpeg-static'
import { dataPaths, getDatabase } from '../database'
import { assets, imports, tracks } from '../database/schema'
import { fileHash, importFile } from './importer'
import { notifyDesktop } from './desktop-events'
import { scanTrackGenres } from './genres'
import { completeNextYouTubeSong, youtubeMetadataDelay } from './youtube-metadata'
import { hasQueuedDownloads, processNextDownload, resetAudioDownloads, stopAudioDownloads, downloadBusy } from './audio-downloads'
import { completeNextMotionArt, motionArtChanged, motionArtDelay } from './motion-art'

let busy = false
export const workerBusy = () => busy || !!conversionProcess || downloadBusy()
let stopped = true
let scheduled = false
let running: Promise<void> | undefined
let conversionProcess: ReturnType<typeof spawn> | undefined
let metadataTimer: ReturnType<typeof setTimeout> | undefined
let motionTimer: ReturnType<typeof setTimeout> | undefined
let motionTimerAt = 0
const playingClients = new Map<string, number>()
const CLIENT_TIMEOUT = 90_000

function sweepPlayingClients(now = Date.now()) {
  let dropped = false
  for (const [id, seen] of playingClients) {
    if (now - seen > CLIENT_TIMEOUT) {
      playingClients.delete(id)
      dropped = true
    }
  }
  if (dropped) wakeWorkers()
}

export function setPlaybackActivity(clientId: string, playing: boolean, now = Date.now()) {
  sweepPlayingClients(now)
  if (playing) playingClients.set(clientId, now)
  else playingClients.delete(clientId)
  if (playing && conversionProcess) conversionProcess.kill()
  if (!playing) wakeWorkers()
}

export function conversionPaused(now = Date.now()) {
  sweepPlayingClients(now)
  return playingClients.size > 0
}
export function resumeConversions() { playingClients.clear(); wakeWorkers() }

export async function convertTrack(trackId: string) {
  const db = getDatabase()
  const track = db.select().from(tracks).where(eq(tracks.id, trackId)).get()
  if (!track || conversionPaused()) return
  const source = db.select().from(assets).where(eq(assets.id, track.originalId)).get()!
  const id = randomUUID()
  const temporary = join(dataPaths().staging, `${trackId}.m4a.partial`)
  db.update(tracks).set({ conversion: 'running', conversionError: null, conversionProgress: 0 }).where(eq(tracks.id, trackId)).run()
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.OPENFY_FFMPEG || ffmpegPath || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', join(dataPaths().originals, source.filename),
        '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart',
        '-progress', 'pipe:1', '-f', 'mp4', temporary,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      conversionProcess = child
      let pending = '', lastProgress = -1
      child.stdout.on('data', chunk => {
        pending += chunk.toString()
        const lines = pending.split('\n')
        pending = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('out_time_us=')) continue
          const progress = Math.min(99, Math.round(Number(line.slice(12)) / 1_000_000 / track.metadata.duration * 100))
          if (Number.isFinite(progress) && progress !== lastProgress) {
            lastProgress = progress
            db.update(tracks).set({ conversionProgress: progress }).where(eq(tracks.id, trackId)).run()
            notifyDesktop('conversionProgress', { trackId, progress })
          }
        }
      })
      // Drain stderr without exposing local filesystem paths to clients.
      child.stderr.on('data', () => {})
      child.on('error', reject)
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('Conversion interrupted')))
    })
    const hash = await fileHash(temporary)
    const info = await stat(temporary)
    if (!info.size) throw new Error('Empty conversion')
    await rename(temporary, join(dataPaths().mobile, `${id}.m4a`))
    db.transaction(tx => {
      tx.insert(assets).values({ id, filename: `${id}.m4a`, mime: 'audio/mp4', bytes: info.size, hash, variant: 'mobile' }).run()
      tx.update(tracks).set({ mobileId: id, conversion: 'ready', conversionProgress: 100, conversionError: null }).where(eq(tracks.id, trackId)).run()
    })
  } catch {
    const paused = conversionPaused()
    db.update(tracks).set({ conversion: paused ? 'pending' : 'failed', conversionProgress: 0,
      conversionError: paused ? null : 'No se pudo convertir. Comprueba FFmpeg y el espacio del PC; después reintenta.' }).where(eq(tracks.id, trackId)).run()
  } finally {
    conversionProcess = undefined
    await rm(temporary, { force: true }).catch(() => {})
    notifyDesktop('libraryChanged', { trackIds: [trackId] })
  }
}

export async function runWorker() {
  if (busy) return
  busy = true
  try {
    const db = getDatabase()
    const job = db.select().from(imports).where(eq(imports.state, 'processing')).get()
    if (job) {
      await importFile(job.id)
      const completed = db.select().from(imports).where(eq(imports.id, job.id)).get()
      notifyDesktop('libraryChanged', completed?.trackId ? { trackIds: [completed.trackId] } : {})
      motionArtChanged()
    }
    else if (hasQueuedDownloads()) { await processNextDownload(); motionArtChanged() }
    else if (!conversionPaused()) {
      const track = db.select().from(tracks).where(eq(tracks.conversion, 'pending')).get()
      if (track) await convertTrack(track.id)
      else {
        const unscanned = db.select().from(tracks).where(eq(tracks.genresScanned, false)).get()
        if (unscanned) await scanTrackGenres(unscanned.id)
        else await runLookups()
      }
    }
    else await runLookups()
  } finally { busy = false }
}

/**
 * Paced third-party lookups, after every local job. Both use the iTunes Search API and its request
 * limit, so animated covers wait until no song is left to complete.
 */
async function runLookups() {
  const metadata = youtubeMetadataDelay()
  if (metadata === 0) await completeNextYouTubeSong()
  else if (metadata === null && motionArtDelay() === 0) await completeNextMotionArt()
}

export function startWorkers() {
  stopped = false
  const db = getDatabase()
  db.update(tracks).set({ conversion: 'pending', conversionProgress: 0 }).where(eq(tracks.conversion, 'running')).run()
  resetAudioDownloads()
  wakeWorkers()
}

export function wakeWorkers() {
  if (stopped || scheduled || running) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    if (stopped) return
    running = (async () => {
      do {
        const db = getDatabase()
        const pending = db.select().from(imports).where(eq(imports.state, 'processing')).get()
          || hasQueuedDownloads()
          || (!conversionPaused() && (db.select().from(tracks).where(eq(tracks.conversion, 'pending')).get() || db.select().from(tracks).where(eq(tracks.genresScanned, false)).get()))
          || metadataDue() || motionDue()
        if (!pending || stopped) break
        await runWorker()
      } while (!stopped)
    })().catch(error => console.error('[Openfy] Worker failed', error)).finally(() => { running = undefined })
  })
}

/** Song metadata is paced by the provider; wait on a timer instead of polling. */
function metadataDue() {
  const delay = youtubeMetadataDelay()
  if (delay === null) return false
  if (delay === 0) return true
  if (!metadataTimer) metadataTimer = setTimeout(() => { metadataTimer = undefined; wakeWorkers() }, delay).unref()
  return false
}

/** Animated covers follow the same rule: one album at a time, woken by a timer. */
function motionDue() {
  if (youtubeMetadataDelay() !== null) return false
  const delay = motionArtDelay()
  if (delay === null || delay === 0) {
    clearTimeout(motionTimer); motionTimer = undefined; motionTimerAt = 0
    return delay === 0
  }
  // Node timers overflow above ~24.8 days. A newly added album can also be due before an existing timer.
  const wait = Math.min(delay, 2_147_000_000), at = Date.now() + wait
  if (!motionTimer || at < motionTimerAt) {
    clearTimeout(motionTimer); motionTimerAt = at
    motionTimer = setTimeout(() => { motionTimer = undefined; motionTimerAt = 0; wakeWorkers() }, wait).unref()
  }
  return false
}

export async function stopWorkers() {
  stopped = true
  clearTimeout(metadataTimer); metadataTimer = undefined
  clearTimeout(motionTimer); motionTimer = undefined; motionTimerAt = 0
  stopAudioDownloads()
  conversionProcess?.kill()
  await running
}
