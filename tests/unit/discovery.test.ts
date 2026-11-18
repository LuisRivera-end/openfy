import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDatabase, closeDatabase } from '../../server/database'
import { listeningDays, listeningSessions, recommendationCache } from '../../server/database/schema'
import { ingestListening } from '../../server/utils/telemetry'
import { getRecommendations, recommendationSeeds, selectDiscoveries, selectNewReleases } from '../../server/utils/recommendations'
import { discoveryArtist, isUnknownSong, knownMusic } from '../../shared/utils/discovery'
import type { LibraryItem, YouTubeAlbum, YouTubeSong } from '../../shared/types/music'
import { listeningDay } from '../../shared/utils/telemetry'

const year = new Date().getFullYear()
let directory: string
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'openfy-discovery-')); process.env.OPENFY_DATA_DIR = directory })
beforeEach(() => { const db = getDatabase(); db.delete(listeningDays).run(); db.delete(listeningSessions).run(); db.delete(recommendationCache).run() })
afterAll(async () => { closeDatabase(); delete process.env.OPENFY_DATA_DIR; await rm(directory, { recursive: true, force: true }) })
function song(index: number, artist = `Nuevo artista ${index}`, title = `Descubrimiento ${index}`): YouTubeSong {
  return { videoId: `new${String(index).padStart(8, '0')}`, title, artists: [artist], album: `Disco ${index}`, artwork: null, duration: 100 }
}
function item(value: YouTubeSong): LibraryItem { return { id: `youtube:${value.videoId}`, title: value.title, artist: value.artists.join(', '), album: value.album!, artwork: null, palette: [], duration: 100, favorite: true, format: 'YouTube Music', source: 'youtube', albumId: value.albumId || undefined, entry: { source: 'youtube', song: value } } }
function listen(value: YouTubeSong) {
  const at = Date.now() - 120000
  ingestListening([{ id: randomUUID(), deviceId: randomUUID(), sequence: 1, entry: { source: 'youtube', song: value }, startedAt: at, updatedAt: at + 1000, durationMs: 100000, listenedMs: 1000, days: { [listeningDay(at)]: 1000 }, qualifiedAt: null }])
}
function release(index: number, released: number | null = year, title = `Estreno ${index}`): YouTubeAlbum { return { id: `MPREb_release${index}`, title, artists: [{ id: null, name: `Artista ${index}` }], artwork: null, year: released } }

describe('discovery ranking', () => {
  it('recognizes artist aliases by catalog ID for known recordings and diversity limits', () => {
    const reference = { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'FINNEAS' }
    const known = item({ ...song(1, 'FINNEAS'), artistRefs: [reference] })
    const duplicate = { ...song(2, "Finneas O’Connell", known.title), artistRefs: [{ ...reference, name: "Finneas O’Connell" }] }
    expect(isUnknownSong(duplicate, knownMusic([known]))).toBe(false)
    const aliases = Array.from({ length: 5 }, (_, i) => ({ song: { ...song(10 + i, i % 2 ? 'FINNEAS' : "Finneas O’Connell"), artistRefs: [reference] }, affinity: 1 }))
    expect(selectDiscoveries(aliases, [])).toHaveLength(2)
  })
  it('excludes all known tracks and equivalent official-video/remaster uploads, including local metadata', () => {
    const known = [item(song(1, 'The Marías', 'Siénna')), item(song(2)), item(song(3))]
    const local = { ...known[0]!, id: 'local-id', source: 'local' as const, entry: { source: 'local' as const, trackId: 'local-id' } }
    const duplicate = song(99, 'The Marias - Topic', 'Sienna (Official Video) - 2026 Remastered')
    const pool = [...known.map(row => row.entry.source === 'youtube' ? row.entry.song : song(0)), duplicate, song(5)].map(song => ({ song, affinity: 1 }))
    expect(selectDiscoveries(pool, [...known, local]).map(song => song.videoId)).toEqual([song(5).videoId])
    expect(isUnknownSong(duplicate, knownMusic([local]))).toBe(false)
  })
  it('prefers unfamiliar artists, limits repetition, and prioritizes verified current-year material', () => {
    const known = Array.from({ length: 6 }, (_, i) => item(song(100 + i, `Familiar ${i}`)))
    const pool = [...Array.from({ length: 20 }, (_, i) => ({ song: song(i), affinity: 1 })),
      ...known.flatMap((row, i) => [0, 1, 2].map(n => ({ song: song(200 + i * 3 + n, row.artist), affinity: 1, year })))]
    const selected = selectDiscoveries(pool, known).slice(0, 12)
    expect(selected.filter(song => song.artists.every(artist => !knownMusic(known).artists.has(discoveryArtist(artist))))).toHaveLength(8)
    const counts = new Map<string, number>()
    for (const entry of selected) for (const artist of entry.artists) counts.set(artist, (counts.get(artist) || 0) + 1)
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2)
    const sameArtist = selectDiscoveries([{ song: song(10, 'Un artista'), affinity: 1 }, { song: song(11, 'Un artista'), affinity: 1, year }], [])
    expect(sameArtist[0]?.videoId).toBe(song(11).videoId)
  })
  it('rotates away from the previous batch when alternatives exist', () => {
    const pool = Array.from({ length: 80 }, (_, i) => ({ song: song(i), affinity: 1 }))
    const first = selectDiscoveries(pool, [], 1)
    const shown = Object.fromEntries(first.map(song => [song.videoId, 1]))
    const second = selectDiscoveries(pool, [], 2, shown)
    expect(second).toHaveLength(20)
    expect(second.filter(song => first.some(previous => previous.videoId === song.videoId))).toHaveLength(0)
  })
  it('rotates source artists while retaining the strongest taste anchors', () => {
    const items = Array.from({ length: 15 }, (_, i) => item(song(i)))
    const first = recommendationSeeds(items, {}, {}, 0), second = recommendationSeeds(items, {}, {}, 1)
    expect(first).toHaveLength(6); expect(second.slice(0, 3)).toEqual(first.slice(0, 3))
    expect(second.slice(3)).not.toEqual(first.slice(3))
  })
  it('never calls an old, undated, future, known, or reissued album a current release', () => {
    const known = item({ ...song(1, 'Artista 1'), album: 'Estreno 1', albumId: 'MPREb_release1' })
    const releases = [release(1), release(2, year - 1), release(3, null), release(4, year + 1), release(5, year, 'Disco (Anniversary Remaster)'), release(6), release(6), release(7, year, 'Estreno 1')]
    releases[7]!.artists = [{ id: null, name: 'Artista 1' }]
    expect(selectNewReleases(releases, [known]).map(release => release.id)).toEqual(['MPREb_release6'])
  })
})

describe('discovery generation and cache', () => {
  it('expands similar artists and obtains genuine current releases instead of replaying their greatest hits', async () => {
    const seed = song(1, 'Favorito'); listen(seed)
    const fresh = release(5), unknown = song(5), freshSong = song(6, 'Artista 5')
    const result = await getRecommendations(true, { search: async () => ({ songs: [] }), related: async () => [seed],
      profile: async artist => artist.name === 'Favorito' ? { artist, songs: [seed], releases: [], similar: [{ id: null, name: 'Artista 5' }] }
        : { artist, songs: [unknown], releases: [fresh], similar: [] },
      album: async () => ({ ...fresh, songs: [freshSong] }),
    })
    expect(result.songs.map(song => song.videoId)).toContain(unknown.videoId)
    expect(result.songs.map(song => song.videoId)).not.toContain(seed.videoId)
    expect(result.releases).toEqual([fresh]); expect(result.algorithmVersion).toBe(2)
    expect(result).not.toHaveProperty('pool'); expect(result).not.toHaveProperty('shown')
  })
  it('filters new listens out of fresh cached recommendations without calling the provider', async () => {
    const seed = song(1), discovery = song(2); listen(seed)
    let calls = 0
    const provider = { search: async () => ({ songs: [] }), related: async () => { calls++; return [discovery] } }
    expect((await getRecommendations(true, provider)).songs).toHaveLength(1)
    listen(discovery)
    expect((await getRecommendations(false, provider)).songs).toHaveLength(0)
    expect(calls).toBe(1)
  })
  it('invalidates the legacy cache and never uses familiar songs to fill an outage', async () => {
    const seed = song(1); listen(seed)
    getDatabase().insert(recommendationCache).values({ key: 'home', value: { songs: [seed], generatedAt: Date.now(), stale: false, error: null } }).run()
    const result = await getRecommendations(false, { search: async () => ({ songs: [] }), related: async () => { throw new Error('offline') } })
    expect(result.songs).toEqual([]); expect(result.stale).toBe(true); expect(result.algorithmVersion).toBe(2)
  })
})
