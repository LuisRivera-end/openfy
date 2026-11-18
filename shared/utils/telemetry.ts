import type { ListeningPeriod, ListeningSession } from '../types/telemetry'
import type { PlaybackEntry } from '../types/music'
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export const LISTENING_TIMEZONE = 'America/Mexico_City'
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: LISTENING_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
export function listeningDay(at: number) {
  const parts = dateFormat.formatToParts(at)
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-')
}
export function periodStart(period: ListeningPeriod, now = Date.now()) {
  const today = listeningDay(now)
  if (period === 'all') return '0000-01-01'
  if (period === 'year') return today.slice(0, 4) + '-01-01'
  const date = new Date(today + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() - (period === '7d' ? 6 : 29))
  return date.toISOString().slice(0, 10)
}

/** Actual advancing audio only. Call reset at every seek/source discontinuity. */
export class ListeningAccumulator {
  session: ListeningSession
  private position = 0
  private clock = 0
  private wall = 0
  private audible = false
  constructor(entry: PlaybackEntry, deviceId: string, id: string, at: number, restored?: ListeningSession) {
    this.session = restored ? copy(restored) : { id, deviceId, sequence: 0, entry: copy(entry), startedAt: at, updatedAt: at, durationMs: null, listenedMs: 0, days: {}, qualifiedAt: null, ...(entry.context ? { context: copy(entry.context) } : {}) }
  }
  reset(position: number, monotonic: number, at: number, audible: boolean) {
    this.position = position; this.clock = monotonic; this.wall = at; this.audible = audible
  }
  sample(position: number, duration: number, monotonic: number, at: number, audible: boolean) {
    const advance = (position - this.position) * 1000
    const elapsed = Math.max(0, monotonic - this.clock)
    // A large position jump without a matching clock advance is a seek, never listening.
    const amount = this.audible && advance >= 0 && advance <= elapsed + 250 ? Math.floor(Math.min(advance, elapsed)) : 0
    if (Number.isFinite(duration) && duration > 0) this.session.durationMs = Math.round(duration * 1000)
    if (amount > 0) {
      const before = this.session.listenedMs
      // Map elapsed time onto real dates, splitting at local midnight (including DST).
      let start = Math.max(this.wall, at - amount)
      while (start < at) {
        const day = listeningDay(start)
        let end = at
        if (listeningDay(at - 1) !== day) {
          let low = start, high = at
          while (high - low > 1) { const mid = Math.floor((low + high) / 2); if (listeningDay(mid) === day) low = mid; else high = mid }
          end = high
        }
        this.session.days[day] = (this.session.days[day] || 0) + (end - start)
        start = end
      }
      this.session.listenedMs = Object.values(this.session.days).reduce((sum, value) => sum + value, 0)
      const threshold = (this.session.durationMs || Infinity) * .9
      if (this.session.qualifiedAt === null && this.session.listenedMs >= threshold) this.session.qualifiedAt = Math.round(at - Math.max(0, this.session.listenedMs - threshold))
      if (this.session.listenedMs < before) throw new Error('Listening clock regressed')
    }
    if (this.session.durationMs && this.session.listenedMs < this.session.durationMs * .9) this.session.qualifiedAt = null
    else if (this.session.durationMs && this.session.qualifiedAt === null) this.session.qualifiedAt = Math.round(at - Math.max(0, this.session.listenedMs - this.session.durationMs * .9))
    this.session.updatedAt = at
    this.reset(position, monotonic, at, audible)
  }
  checkpoint() { this.session.sequence++; return copy(this.session) }
}
