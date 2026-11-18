import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDatabase, closeDatabase } from '../../server/database'
import { listeningDays, listeningSessions, recommendationCache, playlists } from '../../server/database/schema'
import { eq } from 'drizzle-orm'
import { ingestListening, listeningSessionSchema, listeningStats, mostPlayed, recentlyPlayed } from '../../server/utils/telemetry'
import { ListeningAccumulator, listeningDay, periodStart } from '../../shared/utils/telemetry'
import { contextKey, recentRoute } from '../../shared/utils/recent'
import { filterLibrary, defaultLibraryFilters } from '../../shared/utils/library-filters'
import { getRecommendations, matchRecommendationSeed, interleaveRecommendations, recommendationSeeds } from '../../server/utils/recommendations'
import type { LibraryItem, PlaybackEntry, YouTubeSong } from '../../shared/types/music'
import type { ListeningContext, ListeningSession, RecentCard } from '../../shared/types/telemetry'
import fixture from '../fixtures/listening-contract.json'

const entry = fixture.entry as PlaybackEntry
const at = fixture.startedAt
let directory: string
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'openfy-listening-')); process.env.OPENFY_DATA_DIR = directory })
beforeEach(() => { const db = getDatabase(); db.delete(listeningDays).run(); db.delete(listeningSessions).run(); db.delete(recommendationCache).run(); db.delete(playlists).run() })
afterAll(async () => { closeDatabase(); delete process.env.OPENFY_DATA_DIR; await rm(directory, { recursive: true, force: true }) })

function session(ms = 90000, overrides: Partial<ListeningSession> = {}): ListeningSession {
  return { id: randomUUID(), deviceId: fixture.deviceId, sequence: 1, entry, startedAt: at, updatedAt: at + ms, durationMs: 100000, listenedMs: ms, days: { [listeningDay(at)]: ms }, qualifiedAt: ms >= 90000 ? at + 90000 : null, ...overrides }
}
function item(id: string, artist = 'Openfy', genres: string[] = []): LibraryItem {
  return { id, source: 'youtube', title: 'Horizonte', artist, album: 'Música', duration: 100, artwork: null, palette: [], favorite: false, format: 'YouTube Music', genres, entry: { source: 'youtube', song: { ...(entry as Extract<PlaybackEntry, { source: 'youtube' }>).song, videoId: id.replace('youtube:', ''), artists: [artist] } } }
}

describe('shared listening contract', () => {
  it('keeps the entry context on the session and across restoration', () => {
    const context = { ...fixture.context, kind: 'album' as const }
    const accumulator = new ListeningAccumulator({ ...entry, context }, fixture.deviceId, fixture.sessionId, at)
    const checkpoint = accumulator.checkpoint()
    expect(checkpoint.context).toEqual(context)
    context.title = 'Changed after selection'
    expect(accumulator.session.context?.kind === 'album' && accumulator.session.context.title).toBe('Contrato')
    context.title = 'Contrato'
    expect(new ListeningAccumulator(entry, fixture.deviceId, fixture.sessionId, at, checkpoint).checkpoint().context).toEqual(context)
    expect(new ListeningAccumulator(entry, fixture.deviceId, fixture.sessionId, at).checkpoint()).not.toHaveProperty('context')
  })
  it('validates listening contexts, including omitted C# artwork', () => {
    const context = { kind: 'album', id: 'youtube:MPRE1', title: 'A', subtitle: 'B' } as const
    expect(listeningSessionSchema.safeParse(session(1000, { context })).success).toBe(true)
    expect(listeningSessionSchema.safeParse(session(1000, { context: { ...context, artwork: null } })).success).toBe(true)
    for (const invalid of [{ kind: 'playlist' }, { kind: 'nope' }, { ...context, title: 'a'.repeat(501) }, { ...context, id: '' }, { ...context, artwork: 'a'.repeat(2049) }]) {
      expect(listeningSessionSchema.safeParse({ ...session(1000), context: invalid }).success).toBe(false)
    }
  })
  for (const example of fixture.cases) it(example.name, () => {
    const accumulator = new ListeningAccumulator(entry, fixture.deviceId, fixture.sessionId, at)
    accumulator.reset(0, 0, at, false)
    for (const sample of example.samples) accumulator.sample(Number(sample[0]), 100, Number(sample[1]), at + Number(sample[1]), Boolean(sample[2]))
    expect(accumulator.session.listenedMs).toBe(example.listenedMs)
    expect(accumulator.session.qualifiedAt !== null).toBe(example.qualified)
    expect(listeningSessionSchema.safeParse(accumulator.checkpoint()).success).toBe(true)
  })
  it('splits listening at Mexico midnight and handles year boundaries', () => {
    const midnight = Date.parse('2027-01-01T06:00:00Z')
    const accumulator = new ListeningAccumulator(entry, fixture.deviceId, fixture.sessionId, midnight - 5000)
    accumulator.reset(0, 0, midnight - 5000, true)
    accumulator.sample(10, 100, 10000, midnight + 5000, false)
    expect(accumulator.session.days).toEqual({ '2026-12-31': 5000, '2027-01-01': 5000 })
    expect(periodStart('year', midnight)).toBe('2027-01-01')
    expect(periodStart('7d', midnight)).toBe('2026-12-26')
    expect(periodStart('30d', midnight)).toBe('2026-12-03')
  })
  it('preserves a paused session on restoration without crediting its saved position', () => {
    const restored = session(40000)
    const accumulator = new ListeningAccumulator(entry, fixture.deviceId, restored.id, at + 100000, restored)
    accumulator.reset(40, 0, at + 100000, false)
    accumulator.sample(40, 100, 60000, at + 160000, true)
    accumulator.sample(90, 100, 110000, at + 210000, false)
    expect(accumulator.session.listenedMs).toBe(90000)
    expect(accumulator.session.id).toBe(restored.id)
    expect(accumulator.session.qualifiedAt).not.toBeNull()
  })
})
describe('durable idempotent listening', () => {
  it('groups recent listening by context, newest first, once per card', () => {
    const song = (entry as Extract<PlaybackEntry, { source: 'youtube' }>).song
    const other = { source: 'youtube' as const, song: { ...song, videoId: '12345678901' } }
    const playlist = { id: randomUUID(), name: 'Para correr', trackIds: [`youtube:${song.videoId}`], revision: 1, updatedAt: at }
    getDatabase().insert(playlists).values(playlist).run()
    ingestListening([
      session(1000, { context: { kind: 'song' } }),
      session(1000, { entry: other, context: { kind: 'playlist', id: playlist.id }, updatedAt: at + 2000 }),
      session(1000, { context: { kind: 'playlist', id: playlist.id }, updatedAt: at + 3000 }),
      session(1000, { context: { kind: 'favorites' }, updatedAt: at + 4000 }),
      session(1000, { context: { kind: 'album', id: 'youtube:MPRE1', title: 'Álbum', subtitle: 'Openfy', artwork: 'cover.jpg' }, updatedAt: at + 5000 }),
      session(1000, { context: { kind: 'artist', id: 'Openfy', title: 'Openfy', subtitle: '' }, updatedAt: at + 6000 }),
      session(1000, { entry: other, updatedAt: at + 7000 }),
      session(0, { entry: other, context: { kind: 'song' }, updatedAt: at + 8000 }),
    ])
    const result = recentlyPlayed().items
    expect(result.map(card => card.key)).toEqual(['artist:Openfy', 'album:youtube:MPRE1', 'favorites', `playlist:${playlist.id}`, `song:youtube:${song.videoId}`])
    expect(result[0]).toMatchObject({ subtitle: 'Artista', artwork: null, item: null })
    expect(result[1]).toMatchObject({ title: 'Álbum', subtitle: 'Openfy', artwork: 'cover.jpg' })
    expect(result[2]).toMatchObject({ title: 'Tus favoritas', subtitle: '0 canciones' })
    expect(result[3]).toMatchObject({ title: 'Para correr', subtitle: 'Playlist', lastPlayedAt: at + 3000 })
    expect(result[4]).toMatchObject({ title: song.title, subtitle: 'Openfy', item: { id: `youtube:${song.videoId}` } })
    expect(recentlyPlayed(2).items).toHaveLength(2)
    expect(listeningStats('all').listenedMs).toBe(7000)
    getDatabase().update(playlists).set({ name: 'Renombrada' }).where(eq(playlists.id, playlist.id)).run()
    expect(recentlyPlayed().items.find(card => card.kind === 'playlist')?.title).toBe('Renombrada')
    getDatabase().delete(playlists).where(eq(playlists.id, playlist.id)).run()
    expect(recentlyPlayed().items.some(card => card.kind === 'playlist')).toBe(false)
  })
  it('drops recent cards whose target no longer exists', () => {
    ingestListening([session(1000, { context: { kind: 'playlist', id: randomUUID() } }), session(1000, { entry: { source: 'local', trackId: randomUUID() }, context: { kind: 'song' } })])
    expect(recentlyPlayed().items).toEqual([])
  })
  it('uses a stable track key to order recent songs with equal timestamps', () => {
    const song = (entry as Extract<PlaybackEntry, { source: 'youtube' }>).song
    ingestListening(['bbbbbbbbbbb', 'aaaaaaaaaaa'].map(videoId => session(1000, { context: { kind: 'song' }, entry: { source: 'youtube', song: { ...song, videoId } } })))
    expect(recentlyPlayed().items.map(row => row.key)).toEqual(['song:youtube:aaaaaaaaaaa', 'song:youtube:bbbbbbbbbbb'])
  })
  it('builds distinct context keys and encoded local and catalog routes', () => {
    const cases: [ListeningContext, string, string | null][] = [
      [{ kind: 'song' }, 'song:youtube:a', null], [{ kind: 'favorites' }, 'favorites', '/favorites'],
      [{ kind: 'playlist', id: 'p/1' }, 'playlist:p/1', '/playlist/p%2F1'],
      [{ kind: 'album', id: 'youtube:MPRE1', title: '', subtitle: '' }, 'album:youtube:MPRE1', '/music/album/MPRE1'],
      [{ kind: 'album', id: 'local album', title: '', subtitle: '' }, 'album:local album', '/album/local%20album'],
      [{ kind: 'artist', id: 'youtube:UC1', title: '', subtitle: '' }, 'artist:youtube:UC1', '/music/artist/UC1'],
      [{ kind: 'artist', id: 'José José', title: '', subtitle: '' }, 'artist:José José', '/artist/Jos%C3%A9%20Jos%C3%A9'],
    ]
    for (const [context, key, route] of cases) {
      expect(contextKey(context, 'youtube:a')).toBe(key)
      expect(recentRoute({ ...context, key, id: 'id' in context ? context.id : null } as RecentCard)).toBe(route)
    }
  })
  it('accepts duplicate, older, and out-of-order checkpoints exactly once', () => {
    const first = session(40000)
    const second = session(90000, { id: first.id, sequence: 2 })
    ingestListening([second, first, second])
    const stats = listeningStats('all', at + 200000)
    expect(stats.listenedMs).toBe(90000); expect(stats.plays).toBe(1)
    expect(getDatabase().select().from(listeningSessions).all()).toHaveLength(1)
  })
  it('sums separate plays and devices and retains unsaved YouTube metadata', () => {
    ingestListening([session(), session(100000, { deviceId: randomUUID() })])
    const stats = listeningStats('all', at + 200000)
    expect(stats.plays).toBe(2); expect(stats.listenedMs).toBe(190000)
    expect(mostPlayed('all').items[0]?.item.entry).toEqual(entry)
  })
  it('rejects session identity changes and regressing cumulative data atomically', () => {
    const first = session()
    ingestListening([first])
    expect(() => ingestListening([session(), { ...first, sequence: 2, listenedMs: 80000 }])).toThrow()
    expect(listeningStats('all').plays).toBe(1)
    expect(() => ingestListening([{ ...first, sequence: 2, deviceId: randomUUID() }])).toThrow()
  })
  it('updates minutes without recounting a qualified play', () => {
    const first = session()
    ingestListening([first, session(100000, { id: first.id, sequence: 2 })])
    expect(listeningStats('all').plays).toBe(1); expect(listeningStats('all').listenedMs).toBe(100000)
  })
  it('keeps short listens in minutes and only includes qualified plays in the play ranking', () => {
    ingestListening([session(30000)])
    expect(listeningStats('all').listenedMs).toBe(30000)
    expect(mostPlayed('all').total).toBe(0)
    expect(mostPlayed('all', 0, 50, 'minutes').total).toBe(1)
  })
  it('validates the 90 percent threshold and daily sums', () => {
    expect(listeningSessionSchema.safeParse(session(89900, { qualifiedAt: at + 89900 })).success).toBe(false)
    expect(listeningSessionSchema.safeParse(session(90000, { days: {} })).success).toBe(false)
    expect(listeningSessionSchema.safeParse(session()).success).toBe(true)
  })
  it('places minutes and the play in their corresponding day across midnight', () => {
    const midnight = Date.parse('2026-11-12T06:00:00Z')
    const s = session(100000, { startedAt: midnight - 95000, updatedAt: midnight + 5000, days: { '2026-11-11': 95000, '2026-11-12': 5000 }, qualifiedAt: midnight - 5000 })
    ingestListening([s])
    const days = getDatabase().select().from(listeningDays).all()
    expect(days.find(day => day.day === '2026-11-11')?.plays).toBe(1)
    expect(days.find(day => day.day === '2026-11-12')?.plays).toBe(0)
  })
})
describe('recommendation selection and filters', () => {
  it('persists recommendations across restarts, serves cache, and retains it on a provider outage', async () => {
    ingestListening([session(30000)])
    const song = (entry as Extract<PlaybackEntry, { source: 'youtube' }>).song
    let calls = 0
    const provider = { search: async () => ({ songs: [], nextCursor: null }), related: async () => { calls++; return [{ ...song, title: 'Una canción desconocida', videoId: '12345678901' }] } }
    const generated = await getRecommendations(true, provider)
    expect(generated.songs).toHaveLength(1); expect(calls).toBe(1)
    closeDatabase()
    expect((await getRecommendations(false, provider)).songs).toEqual(generated.songs); expect(calls).toBe(1)
    const stale = await getRecommendations(true, { ...provider, related: async () => { throw new Error('offline') } })
    expect(stale.songs).toEqual(generated.songs); expect(stale.stale).toBe(true); expect(stale.error).toBeTruthy()
  })
  it('returns an honest empty recommendation state without seeds', async () => {
    const result = await getRecommendations()
    expect(result.songs).toEqual([]); expect(result.error).toBeNull()
  })
  it('only resolves an unambiguous local title, artist and duration match', () => {
    const seed = item('youtube:abcdefghijk')
    const song = (entry as Extract<PlaybackEntry, { source: 'youtube' }>).song
    expect(matchRecommendationSeed(seed, [song])).toEqual(song)
    expect(matchRecommendationSeed(seed, [song, { ...song, videoId: '12345678901' }])).toBeUndefined()
    expect(matchRecommendationSeed(seed, [{ ...song, duration: 170 }])).toBeUndefined()
  })
  it('interleaves, deduplicates, caps artist exposure and excludes seeds', () => {
    const song = (entry as Extract<PlaybackEntry, { source: 'youtube' }>).song
    const make = (id: string, artist: string) => ({ ...song, videoId: id, artists: [artist] })
    const result = interleaveRecommendations([[make('a', 'A'), make('b', 'A'), make('c', 'A')], [make('d', 'B'), make('a', 'A'), make('e', 'B')]], new Set(['d']))
    expect(result.map(song => song.videoId)).toEqual(['a', 'b', 'e'])
  })
  it('chooses three distinct artists using recent listening, history, then favorites', () => {
    const items = [item('a', 'A'), item('b', 'A'), item('c', 'B'), { ...item('d', 'C'), favorite: true }]
    expect(recommendationSeeds(items, { a: { listenedMs: 50 }, b: { listenedMs: 30 } }, { c: { listenedMs: 100 } }).map(item => item.id)).toEqual(['a', 'c', 'd'])
    expect(recommendationSeeds(items.map(item => ({ ...item, favorite: false })), {}, {})).toEqual([])
  })
  it('combines accent-insensitive search, genre, favorite, source and download filters', () => {
    const a = { ...item('a', 'The Marías', ['Alternativo']), favorite: true, title: 'Siénna' }
    const b = item('b', 'Otro')
    const filters = { ...defaultLibraryFilters(), query: 'sienna', genre: 'alternativo', favorite: true, source: 'youtube' as const, downloaded: true }
    expect(filterLibrary([a, b], filters, {}, new Set(['a']))).toEqual([a])
    expect(filterLibrary([a, b], { ...defaultLibraryFilters(), genre: 'Sin género' })).toEqual([b])
  })
  it('sorts numerically without mutating saved playlist order', () => {
    const rows = [item('a'), item('b')]
    const sorted = filterLibrary(rows, { ...defaultLibraryFilters(), sort: 'plays', direction: 'desc' }, { a: { plays: 2, listenedMs: 500, lastPlayedAt: 0 }, b: { plays: 12, listenedMs: 100, lastPlayedAt: 0 } })
    expect(sorted.map(row => row.id)).toEqual(['b', 'a']); expect(rows.map(row => row.id)).toEqual(['a', 'b'])
  })
})
