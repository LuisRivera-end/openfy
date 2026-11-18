import { eq } from 'drizzle-orm'
import { YTNodes } from 'youtubei.js'
import { getDatabase } from '../database'
import { recommendationCache } from '../database/schema'
import { listeningItems, listeningStats } from './telemetry'
import { youtubeSession, searchYouTubeMusic } from './youtube-music'
import { musicArtwork, artistReferences } from './music-normalize'
import { getYouTubeAlbum, getYouTubeDiscoveryArtist, type DiscoveryArtist } from './youtube-catalog'
import { normalizeLibraryText } from '../../shared/utils/library-filters'
import { DISCOVERY_VERSION, discoveryArtist, discoveryArtistKeys, discoveryTitle, isUnknownSong, knownMusic, songIdentities } from '../../shared/utils/discovery'
import type { LibraryItem, YouTubeAlbum, YouTubeAlbumDetail, YouTubeArtistRef, YouTubeSong } from '../../shared/types/music'
import type { Recommendations } from '../../shared/types/telemetry'

const CACHE_KEY = 'home-discovery-v2', TTL = 3600000
type TasteStats = Record<string, { listenedMs: number; lastPlayedAt?: number }>
export interface DiscoveryCandidate { song: YouTubeSong; affinity: number; year?: number | null }
export interface RecommendationProvider {
  search: (query: string) => Promise<{ songs: YouTubeSong[] }>
  related: (seed: YouTubeSong) => Promise<YouTubeSong[]>
  profile?: (artist: YouTubeArtistRef) => Promise<DiscoveryArtist>
  album?: (id: string) => Promise<YouTubeAlbumDetail>
}
interface DiscoveryCache extends Recommendations {
  pool?: DiscoveryCandidate[]
  rotation?: number
  shown?: Record<string, number>
}

function hash(value: string) { let result = 2166136261; for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619); return result >>> 0 }

/** Keep three strong anchors, and rotate the remaining taste sources each refresh. */
export function recommendationSeeds(items: LibraryItem[], recent: TasteStats, lifetime: TasteStats, rotation = 0) {
  const artists = new Set<string>()
  const ranked = [...items].filter(item => recent[item.id]?.listenedMs || lifetime[item.id]?.listenedMs || item.favorite)
    .sort((a, b) => (recent[b.id]?.listenedMs || 0) - (recent[a.id]?.listenedMs || 0) || (lifetime[b.id]?.listenedMs || 0) - (lifetime[a.id]?.listenedMs || 0) || Number(b.favorite) - Number(a.favorite) || a.id.localeCompare(b.id))
    .filter(item => { const name = discoveryArtist(item.entry.source === 'youtube' ? item.entry.song.artists[0] || item.artist : item.artist); if (artists.has(name)) return false; artists.add(name); return true })
  const rest = ranked.slice(3, 21)
  const start = rest.length ? rotation * 3 % rest.length : 0
  return [...ranked.slice(0, 3), ...rest.slice(start), ...rest.slice(0, start)].slice(0, 6)
}

export function matchRecommendationSeed(item: LibraryItem, songs: YouTubeSong[]) {
  const matches = songs.filter(song => normalizeLibraryText(song.title) === normalizeLibraryText(item.title)
    && song.artists.some(artist => normalizeLibraryText(item.artist).split(/,\s*/).includes(normalizeLibraryText(artist)))
    && song.duration !== null && item.duration > 0 && Math.abs(song.duration - item.duration) <= Math.max(5, item.duration * .05))
  return matches.length === 1 ? matches[0] : undefined
}

export function interleaveRecommendations(groups: YouTubeSong[][], excluded = new Set<string>()) {
  const seen = new Set(excluded), artists = new Map<string, number>(), result: YouTubeSong[] = []
  const length = Math.max(0, ...groups.map(group => group.length))
  for (let i = 0; i < length && result.length < 20; i++) for (const group of groups) {
    const song = group[i]; if (!song || seen.has(song.videoId) || result.length >= 20) continue
    const names = song.artists.map(discoveryArtist)
    if (names.some(name => (artists.get(name) || 0) >= 2)) continue
    seen.add(song.videoId); names.forEach(name => artists.set(name, (artists.get(name) || 0) + 1)); result.push(song)
  }
  return result
}

/** Two discovery slots per familiar-artist slot, with a maximum of two per artist. */
export function selectDiscoveries(pool: DiscoveryCandidate[], items: LibraryItem[], rotation = 0, shown: Record<string, number> = {}, year = new Date().getFullYear()) {
  const known = knownMusic(items), unique = new Map<string, DiscoveryCandidate>()
  for (const candidate of pool) {
    const song = candidate.song
    if (!/^[\w-]{11}$/.test(song.videoId) || !song.title || !song.artists.length || !isUnknownSong(song, known)) continue
    const previous = unique.get(song.videoId)
    if (!previous || (candidate.year || 0) > (previous.year || 0) || candidate.affinity > previous.affinity) unique.set(song.videoId, candidate)
  }
  const novel = (candidate: DiscoveryCandidate) => discoveryArtistKeys(candidate.song).every(key => !known.artists.has(key))
  const score = (candidate: DiscoveryCandidate) => candidate.affinity + (candidate.year === year ? 5 : candidate.year === year - 1 ? 2.5 : 0)
    - (shown[candidate.song.videoId] || 0) * 3 + hash(`${rotation}:${candidate.song.videoId}`) / 0xffffffff * 1.5
  const sorted = [...unique.values()].sort((a, b) => score(b) - score(a) || a.song.videoId.localeCompare(b.song.videoId))
  const seen = new Set<string>(), identities = new Set<string>(), artistCounts = new Map<string, number>(), albums = new Map<string, number>(), result: YouTubeSong[] = []
  function take(wantNovel: boolean, maximum: number) {
    return sorted.find(candidate => {
      const song = candidate.song
      return novel(candidate) === wantNovel && !seen.has(song.videoId) && !songIdentities(song).some(key => identities.has(key))
        && discoveryArtistKeys(song).every(key => (artistCounts.get(key) || 0) < maximum)
        && (!song.albumId || (albums.get(song.albumId) || 0) < 2)
    })
  }
  while (result.length < 20) {
    const preferNovel = result.length % 3 !== 2
    const candidate = take(preferNovel, 1) || take(preferNovel, 2) || take(!preferNovel, 1) || take(!preferNovel, 2)
    if (!candidate) break
    const song = candidate.song; seen.add(song.videoId); songIdentities(song).forEach(key => identities.add(key))
    discoveryArtistKeys(song).forEach(key => { artistCounts.set(key, (artistCounts.get(key) || 0) + 1) })
    if (song.albumId) albums.set(song.albumId, (albums.get(song.albumId) || 0) + 1)
    result.push(song)
  }
  return result
}

export function selectNewReleases(releases: YouTubeAlbum[], items: LibraryItem[], year = new Date().getFullYear()) {
  const known = knownMusic(items), seen = new Set<string>(), titles = new Set<string>(), artists = new Map<string, number>()
  const artistKeys = (release: YouTubeAlbum) => discoveryArtistKeys({ artists: release.artists.map(artist => artist.name), artistRefs: release.artists })
  const unfamiliar = releases.filter(release => artistKeys(release).every(key => !known.artists.has(key)))
  const familiar = releases.filter(release => !unfamiliar.includes(release))
  const ordered: YouTubeAlbum[] = []
  for (let i = 0, j = 0; i < unfamiliar.length || j < familiar.length;) {
    if (i < unfamiliar.length) ordered.push(unfamiliar[i++]!)
    if (i < unfamiliar.length) ordered.push(unfamiliar[i++]!)
    if (j < familiar.length) ordered.push(familiar[j++]!)
  }
  return ordered.filter(release => {
    if (release.year !== year || !release.artists.length || known.albums.has(release.id) || seen.has(release.id)
      || /\b(remaster(?:ed)?|anniversary|deluxe|instrumental|sped.?up|slowed|reverb)\b/i.test(release.title)) return false
    const keys = artistKeys(release).map(key => `${key}\u001f${discoveryTitle(release.title)}`)
    if (keys.some(key => known.albums.has(key) || titles.has(key)) || artistKeys(release).some(key => (artists.get(key) || 0) >= 2)) return false
    seen.add(release.id); keys.forEach(key => titles.add(key))
    artistKeys(release).forEach(key => { artists.set(key, (artists.get(key) || 0) + 1) })
    return true
  }).slice(0, 12)
}

async function relatedSongs(seed: YouTubeSong): Promise<YouTubeSong[]> {
  const panel = await (await youtubeSession()).music.getUpNext(seed.videoId)
  return panel.contents.filterType(YTNodes.PlaylistPanelVideo).slice(0, 40).map(item => {
    const refs = artistReferences(item.artists)
    return { videoId: item.video_id, title: item.title.text || '', artists: refs.length ? refs.map(ref => ref.name) : item.author ? [item.author] : [], artistRefs: refs,
      album: item.album?.name || null, albumId: item.album?.id || null, artwork: musicArtwork(item.thumbnail), duration: item.duration.seconds || null }
  }).filter(song => /^[\w-]{11}$/.test(song.videoId) && song.title)
}

/** A shared deadline bounds the whole home request, including a slow provider. */
async function settledMap<T, R>(items: T[], load: (item: T) => Promise<R>, deadline: number): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let index = 0
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (index < items.length) {
      const at = index++, remaining = deadline - Date.now()
      if (remaining <= 0) { results[at] = { status: 'rejected', reason: new Error('Discovery deadline') }; continue }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const value = await Promise.race([load(items[at]!), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Discovery deadline')), remaining) })])
        results[at] = { status: 'fulfilled', value }
      } catch (reason) { results[at] = { status: 'rejected', reason } }
      finally { clearTimeout(timer) }
    }
  }))
  return results
}

const provider: RecommendationProvider = { search: searchYouTubeMusic, related: relatedSongs, profile: getYouTubeDiscoveryArtist, album: getYouTubeAlbum }
let inFlight: Promise<Recommendations> | undefined
function publicRecommendations(value: DiscoveryCache): Recommendations {
  const { pool: _pool, rotation: _rotation, shown: _shown, ...result } = value
  return result
}
export async function getRecommendations(refresh = false, source: RecommendationProvider = provider): Promise<Recommendations> {
  if (inFlight) return inFlight
  const db = getDatabase(), items = [...listeningItems().values()]
  const cached = db.select().from(recommendationCache).where(eq(recommendationCache.key, CACHE_KEY)).get()?.value as DiscoveryCache | undefined
  const valid = cached?.algorithmVersion === DISCOVERY_VERSION ? cached : undefined
  // Refilter even a fresh cache: a saved or newly heard song must disappear immediately.
  if (!refresh && valid && !valid.stale && Date.now() - valid.generatedAt < TTL) return publicRecommendations({ ...valid,
    songs: selectDiscoveries(valid.pool || valid.songs.map(song => ({ song, affinity: 1 })), items, valid.rotation, valid.shown),
    releases: selectNewReleases(valid.releases || [], items) })
  inFlight = (async () => {
    const rotation = (valid?.rotation || 0) + 1, deadline = Date.now() + 20000, known = knownMusic(items)
    const seeds = recommendationSeeds(items, listeningStats('30d').byTrack, listeningStats('all').byTrack, rotation)
    if (!seeds.length) return { songs: [], releases: [], algorithmVersion: DISCOVERY_VERSION, generatedAt: Date.now(), stale: false, error: null }
    const resolved = await settledMap(seeds, async item => item.entry.source === 'youtube' ? item.entry.song : matchRecommendationSeed(item, (await source.search(`${item.title} ${item.artist}`)).songs), deadline)
    const songs = resolved.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
    const references = songs.map(song => song.artistRefs?.find(artist => artist.id) || { id: null, name: song.artists[0] || '' }).filter(ref => ref.name)
    const [related, profiles] = await Promise.all([
      settledMap(songs, source.related, deadline),
      settledMap(references, async ref => source.profile ? source.profile(ref) : { artist: ref, similar: [], releases: [], songs: [] } as DiscoveryArtist, deadline),
    ])
    const base = profiles.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    const similar = new Map<string, YouTubeArtistRef>()
    for (let i = 0; i < 12; i++) for (const profile of base) {
      const artist = profile.similar[i]; if (artist && !known.artists.has(discoveryArtist(artist.name)) && !(artist.id && known.artists.has('id:' + artist.id))) similar.set(artist.id || discoveryArtist(artist.name), artist)
    }
    const unfamiliar = [...similar.values()].sort((a, b) => hash(`${rotation}:${a.id || a.name}`) - hash(`${rotation}:${b.id || b.name}`)).slice(0, 6)
    const expanded = await settledMap(unfamiliar, async ref => source.profile!(ref), deadline)
    const discoveries = expanded.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    let releases = selectNewReleases([...base, ...discoveries].flatMap(profile => profile.releases), items)
    // Explore recent albums of unfamiliar artists instead of their old greatest hits.
    const recentDiscoveries = discoveries.flatMap(profile => [...profile.releases]
      .filter(release => release.year !== null && release.year >= new Date().getFullYear() - 1 && release.year <= new Date().getFullYear()
        && !known.albums.has(release.id) && !/\b(remaster(?:ed)?|anniversary|deluxe|instrumental|sped.?up|slowed|reverb)\b/i.test(release.title))
      .sort((a, b) => b.year! - a.year!).slice(0, 1))
    const albumRequests = [...new Map([...recentDiscoveries, ...releases].map(release => [release.id, release])).values()].slice(0, 8)
    const albumResults = source.album ? await settledMap(albumRequests, release => source.album!(release.id), deadline) : []
    const albums = albumResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    const rejectedYears = new Set(albums.filter(album => releases.some(release => release.id === album.id) && album.year !== null && album.year !== new Date().getFullYear()).map(album => album.id))
    releases = releases.filter(release => !rejectedYears.has(release.id))
    const pool: DiscoveryCandidate[] = [
      ...related.flatMap(result => result.status === 'fulfilled' ? result.value.map((song, i) => ({ song, affinity: 1 - i * .005 })) : []),
      ...discoveries.flatMap(profile => profile.songs.slice(0, 15).map((song, i) => ({ song, affinity: 1.4 - i * .02 }))),
      ...albums.flatMap(album => [...album.songs].filter(song => (song.duration === null || song.duration >= 60) && !/^(intro|outro|interlude)$/i.test(song.title.trim()))
        .sort((a, b) => hash(`${rotation}:${a.videoId}`) - hash(`${rotation}:${b.videoId}`)).slice(0, 4)
        .map(song => ({ song, affinity: 1.8, year: album.year ?? albumRequests.find(release => release.id === album.id)?.year }))),
    ]
    const failed = [...resolved, ...related, ...profiles, ...expanded, ...albumResults].some(result => result.status === 'rejected')
    const available = pool.length ? pool : valid?.pool || valid?.songs.map(song => ({ song, affinity: 1 })) || []
    const shown = Object.fromEntries(Object.entries(valid?.shown || {}).slice(-300))
    for (const song of valid?.songs || []) shown[song.videoId] = Math.min(3, (shown[song.videoId] || 0) + 1)
    const selected = selectDiscoveries(available, [...listeningItems().values()], rotation, shown)
    const value: DiscoveryCache = { songs: selected, releases: releases.length ? releases : failed ? selectNewReleases(valid?.releases || [], items) : [],
      generatedAt: Date.now(), stale: failed, error: failed ? 'No se pudieron consultar todas las sugerencias. Puedes reintentar.' : null,
      algorithmVersion: DISCOVERY_VERSION, rotation, shown, pool: available.slice(0, 500) }
    db.insert(recommendationCache).values({ key: CACHE_KEY, value }).onConflictDoUpdate({ target: recommendationCache.key, set: { value } }).run()
    return publicRecommendations(value)
  })()
  try { return await inFlight } finally { inFlight = undefined }
}
