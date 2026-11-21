import { and, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { getDatabase } from '../database'
import { listeningDays, listeningSessions } from '../database/schema'
import { youtubeSongSchema } from './saved-music'
import { readLibrary } from './library'
import { collectionMap } from '../../shared/utils/collections'
import { describePlayback, playbackKey } from '../../shared/utils/playback'
import { listeningDay, periodStart } from '../../shared/utils/telemetry'
import { contextKey } from '../../shared/utils/recent'
import { defaultLibraryFilters, filterLibrary } from '../../shared/utils/library-filters'
import type { Library, Track } from '../../shared/types/music'
import type { LibraryFilters, ListeningSession, ListeningStats, MostPlayedPage, RecentCard, RecentListening, ListeningPeriod, TrackStatistics } from '../../shared/types/telemetry'

const timestamp = z.number().int().nonnegative().max(8640000000000000)
export const listeningPeriodSchema = z.enum(['7d', '30d', 'year', 'all'])
const contextId = z.string().min(1).max(512)
const contextMetadata = { id: contextId, title: z.string().max(500), subtitle: z.string().max(500), artwork: z.string().max(2048).nullable().optional() }
export const listeningContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('song') }), z.object({ kind: z.literal('favorites') }),
  z.object({ kind: z.literal('playlist'), id: contextId }),
  z.object({ kind: z.literal('album'), ...contextMetadata }), z.object({ kind: z.literal('artist'), ...contextMetadata }),
])
export const listeningSessionSchema = z.object({
  id: z.string().uuid(), deviceId: z.string().uuid(), sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  entry: z.discriminatedUnion('source', [z.object({ source: z.literal('local'), trackId: z.string().uuid() }), z.object({ source: z.literal('youtube'), song: youtubeSongSchema })]),
  startedAt: timestamp, updatedAt: timestamp, durationMs: z.number().int().positive().max(86400000).nullable(),
  listenedMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  days: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().int().nonnegative().max(86400000)),
  qualifiedAt: timestamp.nullable(),
  context: listeningContextSchema.optional(),
}).superRefine((value, context) => {
  const days = Object.entries(value.days)
  const fail = (message: string) => context.addIssue({ code: 'custom', message })
  if (value.updatedAt < value.startedAt || value.updatedAt > Date.now() + 300000 || value.listenedMs > value.updatedAt - value.startedAt + 1000) fail('Reloj de escucha no válido.')
  if (days.length > 3660 || days.reduce((sum, [, ms]) => sum + ms, 0) !== value.listenedMs) fail('Acumulados de escucha no válidos.')
  if (days.some(([day]) => !Number.isFinite(Date.parse(day + 'T12:00:00Z')) || new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) !== day || day < listeningDay(value.startedAt) || day > listeningDay(value.updatedAt))) fail('Día de escucha no válido.')
  if (value.qualifiedAt !== null && (!value.durationMs || value.listenedMs < value.durationMs * .9 || value.qualifiedAt < value.startedAt || value.qualifiedAt > value.updatedAt)) fail('La reproducción requiere escuchar el 90 % del audio.')
})
export const listeningBatchSchema = z.object({ sessions: z.array(listeningSessionSchema).min(1).max(100) })

/** Atomic replacement by monotonic version; rollups receive only the delta. */
export function ingestListening(sessions: ListeningSession[]) {
  const db = getDatabase()
  return db.transaction(tx => {
    const accepted: { id: string; sequence: number }[] = []
    for (const snapshot of sessions) {
      const trackKey = playbackKey(snapshot.entry)
      const previous = tx.select().from(listeningSessions).where(eq(listeningSessions.id, snapshot.id)).get()?.snapshot
      if (previous && (previous.deviceId !== snapshot.deviceId || playbackKey(previous.entry) !== trackKey || previous.startedAt !== snapshot.startedAt)) throw new Error('La identidad de la sesión no puede cambiar.')
      if (previous && previous.sequence >= snapshot.sequence) { accepted.push({ id: snapshot.id, sequence: previous.sequence }); continue }
      if (previous && (snapshot.listenedMs < previous.listenedMs || snapshot.updatedAt < previous.updatedAt || Object.entries(previous.days).some(([day, ms]) => (snapshot.days[day] || 0) < ms))) throw new Error('La escucha acumulada no puede retroceder.')
      const priorPlayDay = previous?.qualifiedAt ? listeningDay(previous.qualifiedAt) : null
      const playDay = snapshot.qualifiedAt ? listeningDay(snapshot.qualifiedAt) : null
      const days = new Set([...Object.keys(snapshot.days), ...(priorPlayDay ? [priorPlayDay] : []), ...(playDay ? [playDay] : [])])
      for (const day of days) {
        const deltaMs = (snapshot.days[day] || 0) - (previous?.days[day] || 0)
        const deltaPlays = Number(day === playDay) - Number(day === priorPlayDay)
        if (!deltaMs && !deltaPlays) continue
        const key = `${trackKey}|${day}`
        const row = tx.select().from(listeningDays).where(eq(listeningDays.key, key)).get()
        const values = { key, trackKey, day, listenedMs: (row?.listenedMs || 0) + deltaMs, plays: (row?.plays || 0) + deltaPlays,
          lastPlayedAt: Math.max(row?.lastPlayedAt || 0, snapshot.updatedAt) }
        tx.insert(listeningDays).values(values).onConflictDoUpdate({ target: listeningDays.key, set: values }).run()
      }
      tx.insert(listeningSessions).values({ id: snapshot.id, trackKey, snapshot }).onConflictDoUpdate({ target: listeningSessions.id, set: { snapshot } }).run()
      accepted.push({ id: snapshot.id, sequence: snapshot.sequence })
    }
    return { accepted }
  })
}

export function listeningStats(period: ListeningPeriod = '30d', now = Date.now()): ListeningStats {
  const rows = getDatabase().select().from(listeningDays).where(and(gte(listeningDays.day, periodStart(period, now)), lte(listeningDays.day, listeningDay(now)))).all()
  const byTrack: Record<string, TrackStatistics> = {}
  for (const row of rows) {
    const stats = byTrack[row.trackKey] ||= { listenedMs: 0, plays: 0, lastPlayedAt: 0 }
    stats.listenedMs += row.listenedMs; stats.plays += row.plays; stats.lastPlayedAt = Math.max(stats.lastPlayedAt, row.lastPlayedAt)
  }
  const values = Object.values(byTrack)
  return { period, byTrack, listenedMs: values.reduce((sum, value) => sum + value.listenedMs, 0), plays: values.reduce((sum, value) => sum + value.plays, 0), lastPlayedAt: Math.max(0, ...values.map(value => value.lastPlayedAt)) }
}

function readListeningSessions() {
  return getDatabase().select({ trackKey: listeningSessions.trackKey, snapshot: listeningSessions.snapshot }).from(listeningSessions).all()
}

export function listeningItems(library: Library = readLibrary(), sessions = readListeningSessions(), keys?: ReadonlySet<string>) {
  const items = keys ? collectionMap(library.tracks.filter(track => keys.has(track.id)), library.youtubeSongs?.filter(saved => keys.has(`youtube:${saved.song.videoId}`)))
    : collectionMap(library.tracks, library.youtubeSongs)
  if (keys && items.size === keys.size) return items
  const locals = new Map<string, Track>()
  // History has its own references. Listening must never implicitly save a favorite.
  for (const { snapshot } of sessions) {
    if (snapshot.entry.source === 'local') continue
    const key = playbackKey(snapshot.entry)
    if (items.has(key) || (keys && !keys.has(key))) continue
    const item = describePlayback(snapshot.entry, locals)
    if (item) items.set(key, { ...item, genres: snapshot.entry.song.genres || [], entry: snapshot.entry })
    if (keys && items.size === keys.size) break
  }
  return items
}
export function recentlyPlayed(limit = 12): RecentListening {
  const sessions = readListeningSessions()
  const groups = new Map<string, { trackKey: string; snapshot: ListeningSession }>()
  for (const row of sessions) {
    if (!row.snapshot.context || row.snapshot.listenedMs <= 0) continue
    const key = contextKey(row.snapshot.context, row.trackKey)
    if (!groups.has(key) || groups.get(key)!.snapshot.updatedAt < row.snapshot.updatedAt) groups.set(key, row)
  }
  const library = readLibrary('on-demand')
  const lists = new Map(library.playlists.map(list => [list.id, list]))
  const locals = new Set(library.tracks.map(track => track.id))
  const selected = [...groups].filter(([, { trackKey, snapshot }]) => {
    const context = snapshot.context!
    if (context.kind === 'playlist') return lists.has(context.id)
    return context.kind !== 'song' || snapshot.entry.source === 'youtube' || locals.has(trackKey)
  }).sort(([keyA, a], [keyB, b]) => b.snapshot.updatedAt - a.snapshot.updatedAt || keyA.localeCompare(keyB)).slice(0, limit)
  const trackKeys = new Set<string>()
  for (const [, { trackKey, snapshot }] of selected) {
    const context = snapshot.context!
    if (context.kind === 'song') trackKeys.add(trackKey)
    else if (context.kind === 'playlist') for (const id of lists.get(context.id)!.trackIds) trackKeys.add(id)
  }
  const music = listeningItems(library, sessions, trackKeys)
  const favoriteCount = library.tracks.filter(track => track.favorite).length + (library.youtubeSongs?.filter(saved => saved.favorite).length ?? 0)
  const cards: RecentCard[] = []
  for (const [key, { trackKey, snapshot }] of selected) {
    const context = snapshot.context!
    const base = { kind: context.kind, key, lastPlayedAt: snapshot.updatedAt }
    if (context.kind === 'song') {
      const item = music.get(trackKey)
      if (item) cards.push({ ...base, id: item.id, title: item.title, subtitle: item.artist, artwork: item.artwork, item })
    } else if (context.kind === 'playlist') {
      const list = lists.get(context.id)
      if (!list) continue
      let artwork: string | null = null
      for (const id of list.trackIds) if ((artwork = music.get(id)?.artwork || null)) break
      cards.push({ ...base, id: list.id, title: list.name, subtitle: 'Playlist', artwork, item: null })
    } else if (context.kind === 'favorites') {
      cards.push({ ...base, id: null, title: 'Tus favoritas', subtitle: `${favoriteCount} canciones`, artwork: null, item: null })
    } else {
      cards.push({ ...base, id: context.id, title: context.title, subtitle: context.subtitle || (context.kind === 'artist' ? 'Artista' : ''), artwork: context.artwork ?? null, item: null })
    }
  }
  return { items: cards }
}

export function mostPlayed(period: ListeningPeriod, offset = 0, limit = 50, sort: 'plays' | 'minutes' = 'plays', filters: Partial<LibraryFilters> = {}): MostPlayedPage {
  const stats = listeningStats(period)
  const items = filterLibrary([...listeningItems().values()].filter(item => (stats.byTrack[item.id]?.plays || 0) > 0 || sort === 'minutes' && (stats.byTrack[item.id]?.listenedMs || 0) > 0), { ...defaultLibraryFilters(), ...filters, sort: 'default' })
    .map(item => ({ item, ...stats.byTrack[item.id]! }))
    .sort((a, b) => (sort === 'minutes' ? b.listenedMs - a.listenedMs : b.plays - a.plays) || b.listenedMs - a.listenedMs || a.item.title.localeCompare(b.item.title, 'es') || a.item.id.localeCompare(b.item.id))
  return { items: items.slice(offset, offset + limit), total: items.length, offset, limit }
}
