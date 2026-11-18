import { eq } from 'drizzle-orm'
import { getDatabase } from '../database'
import { lyrics, youtubeAudio, youtubeSongs } from '../database/schema'
import { lyricsSignature, sameLyricsSignature } from '../../shared/utils/lyrics'
import { resolveLyrics } from './lyrics'
import { LyricsProviderError } from './lrclib'
import { diagnosticError, sessionDiagnostic } from './session-diagnostics'
import { notifyDesktop } from './desktop-events'

/** Completes old downloads independently of playback, imports and audio jobs. */
export class DownloadedLyricsBackfill {
  private retries = new Map<string, number>()
  private stopped = true
  private timer?: ReturnType<typeof setTimeout>
  private running?: Promise<void>
  constructor(private resolve = resolveLyrics, private now = Date.now) {}

  async step(): Promise<number> {
    const now = this.now(), db = getDatabase()
    const saved = new Map(db.select().from(lyrics).all().map(row => [row.key, row.result]))
    const next = db.select({ song: youtubeSongs.song, duration: youtubeAudio.duration }).from(youtubeAudio)
      .innerJoin(youtubeSongs, eq(youtubeSongs.videoId, youtubeAudio.videoId)).all().find(row => {
        if ((this.retries.get(row.song.videoId) || 0) > now) return false
        const cached = saved.get('youtube:' + row.song.videoId)
        return !cached || !sameLyricsSignature(cached.signature, lyricsSignature({ source: 'youtube', song: row.song }, undefined, row.duration))
          || cached.status === 'not_found' && cached.expiresAt <= now
      })
    if (!next) return 60_000
    const target = next.song.videoId
    // Also pace a useful provider fallback that could not be persisted yet.
    this.retries.set(target, now + 60_000)
    sessionDiagnostic('lyrics.backfill', 'started', { target })
    try {
      const result = await this.resolve({ entry: { source: 'youtube', song: next.song }, duration: next.duration })
      sessionDiagnostic('lyrics.backfill', 'completed', { target, lyricsStatus: result.status })
      if (result.status !== 'not_found') notifyDesktop('lyricsChanged', { key: result.key })
    } catch (error) {
      const delay = error instanceof LyricsProviderError ? error.retryAfter * 1000 : 0
      this.retries.set(target, this.now() + Math.max(300_000, delay))
      sessionDiagnostic('lyrics.backfill', 'failed', { target, ...diagnosticError(error) })
      // A service outage should not turn into a request for every missing song.
      return Math.max(60_000, delay)
    }
    return 1000
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(5000)
  }
  private schedule(delay: number) {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      this.running = this.step().catch(() => 60_000).then(next => {
        this.running = undefined
        this.schedule(next)
      })
    }, delay).unref()
  }
  async stop() {
    this.stopped = true
    clearTimeout(this.timer)
    await this.running
  }
}
