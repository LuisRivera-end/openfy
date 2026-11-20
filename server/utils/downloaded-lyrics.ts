import { getDatabase } from '../database'
import type { YouTubeSong } from '../../shared/types/music'
import type { LyricsResult } from '../../shared/types/lyrics'
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
    for (const [id, until] of this.retries) {
      if (until <= now) this.retries.delete(id)
    }
    const stmt = db.$client.prepare<[], { duration: number; song: string; lyrics: string | null }>(`
      SELECT a.duration, s.song, l.result AS lyrics
      FROM youtube_audio a
      INNER JOIN youtube_songs s ON s.video_id = a.video_id
      LEFT JOIN lyrics l ON l.key = 'youtube:' || a.video_id
    `)
    let next: { song: YouTubeSong; duration: number } | undefined
    for (const row of stmt.iterate()) {
      const song = JSON.parse(row.song) as YouTubeSong
      if ((this.retries.get(song.videoId) || 0) > now) continue
      let needsBackfill = false
      if (!row.lyrics) needsBackfill = true
      else {
        const cached = JSON.parse(row.lyrics) as LyricsResult
        if (!sameLyricsSignature(cached.signature, lyricsSignature({ source: 'youtube', song }, undefined, row.duration))
          || (cached.status === 'not_found' && cached.expiresAt <= now)) {
          needsBackfill = true
        }
      }
      if (needsBackfill) { next = { song, duration: row.duration }; break }
    }
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
