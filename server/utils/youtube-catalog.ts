import { YTMusic, YTNodes } from 'youtubei.js'
import type { AlbumSearchResults, ArtistSearchResults, ArtistReleaseResults, MusicSearchResults, YouTubeAlbum, YouTubeAlbumDetail, YouTubeArtist, YouTubeArtistRef, YouTubeArtistProfile, YouTubeSong } from '../../shared/types/music'
import { artistReferences, headerArtistReferences, musicArtwork, musicText, normalizeAlbums, normalizeArtists, normalizeCatalogSongs as normalizeSongs, validAlbumId, validArtistId } from './music-normalize'
import { MusicPageCache, type PageBatch } from './music-search'
import { MusicProviderError, logMusicFailure } from './music-errors'
import { youtubeSession } from './youtube-music'

type BrowsePage = YTMusic.Artist['page']
type ArtistSections = YTMusic.Artist['sections']
type SongItems = Parameters<typeof normalizeSongs>[0]
type AlbumItems = Parameters<typeof normalizeAlbums>[0]
type ArtistItems = Parameters<typeof normalizeArtists>[0]
type ReleaseKind = 'albums' | 'singles'

/** Bounded metadata cache; failed requests are never retained. */
class CatalogCache<T> {
  private entries = new Map<string, { expires: number; value: Promise<T> }>()
  get(id: string, load: () => Promise<T>): Promise<T> {
    for (const [key, item] of this.entries) if (item.expires <= Date.now()) this.entries.delete(key)
    const cached = this.entries.get(id)
    if (cached) { this.entries.delete(id); this.entries.set(id, cached); return cached.value }
    if (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!)
    const entry = { expires: Date.now() + 15 * 60000, value: load().catch(error => {
      if (this.entries.get(id) === entry) this.entries.delete(id)
      throw error
    }) }
    this.entries.set(id, entry)
    return entry.value
  }
}
const artists = new CatalogCache<YTMusic.Artist>()
const albums = new CatalogCache<YouTubeAlbumDetail>()

function checkArtist(id: string) {
  if (!validArtistId(id)) throw new MusicProviderError('INVALID_ID', 'El identificador de artista no es válido.', 400)
}
async function artistPage(id: string) {
  checkArtist(id)
  return artists.get(id, async () => (await youtubeSession()).music.getArtist(id))
}

/** Section contents identify their purpose; localized labels only distinguish release kinds. */
export function artistSection(sections: ArtistSections, kind: 'songs' | ReleaseKind) {
  if (kind === 'songs') return sections.find(section => section instanceof YTNodes.MusicShelf && section.contents.some(item => item.item_type === 'song'))
  return sections.find(section => {
    if (!(section instanceof YTNodes.MusicCarouselShelf) || !section.contents.some(item => 'item_type' in item && item.item_type === 'album')) return false
    const single = /singles?|sencillos?|\beps?\b/i.test(musicText(section.header?.title))
    return kind === 'singles' ? single : !single
  })
}
function sectionEndpoint(section: ReturnType<typeof artistSection>) {
  return section instanceof YTNodes.MusicShelf ? section.endpoint : section?.header?.more_content?.endpoint
}
/**
 * Immersive headers carry a wide banner and no portrait; visual headers carry a
 * portrait (foreground) over an optional backdrop. Keep both roles separate so the
 * profile never crops a banner into a circle when a real portrait exists.
 */
function artistMetadata(page: YTMusic.Artist, id: string): YouTubeArtist & { banner: string | null } {
  const name = musicText(page.header?.title)
  if (!name) throw new MusicProviderError('NOT_FOUND', 'Este artista no está disponible.', 404)
  const header = page.header
  const image = header && 'thumbnail' in header ? header.thumbnail : null
  const backdrop = musicArtwork(Array.isArray(image) ? image : image?.contents)
  const portrait = header instanceof YTNodes.MusicVisualHeader ? musicArtwork(header.foreground_thumbnail) : null
  const banner = header instanceof YTNodes.MusicImmersiveHeader || (portrait && backdrop !== portrait) ? backdrop : null
  return { id, name, artwork: portrait || backdrop, banner }
}

type SearchPage = YTMusic.Search | Awaited<ReturnType<YTMusic.Search['getContinuation']>>
function artistSearchBatch(page: SearchPage): PageBatch<YouTubeArtist> {
  const items = page instanceof YTMusic.Search
    ? page.contents?.filterType(YTNodes.MusicShelf).flatMap(shelf => [...shelf.contents]) || []
    : [...(page.contents?.contents || [])]
  return { items: normalizeArtists(items as ArtistItems), next: page.has_continuation ? async () => artistSearchBatch(await page.getContinuation()) : null }
}
const artistSearches = new MusicPageCache(async query => artistSearchBatch(await (await youtubeSession()).music.search(query, { type: 'artist' })), {
  initialSize: 6, nextSize: 6, identity: artist => artist.id, key: query => query.trim().toLocaleLowerCase('es'),
})
export async function searchYouTubeArtists(query: string, cursor?: string): Promise<ArtistSearchResults> {
  const page = await artistSearches.page(query, cursor)
  return { artists: page.items, nextCursor: page.nextCursor }
}

type AlbumSearchItems = Parameters<typeof normalizeAlbums>[0]
function albumSearchBatch(page: SearchPage): PageBatch<YouTubeAlbum> {
  const items = page instanceof YTMusic.Search
    ? page.contents?.filterType(YTNodes.MusicShelf).flatMap(shelf => [...shelf.contents]) || []
    : [...(page.contents?.contents || [])]
  return { items: normalizeAlbums(items as AlbumSearchItems), next: page.has_continuation ? async () => albumSearchBatch(await page.getContinuation()) : null }
}
const albumSearches = new MusicPageCache(async query => albumSearchBatch(await (await youtubeSession()).music.search(query, { type: 'album' })), {
  initialSize: 6, nextSize: 6, identity: album => album.id, key: query => query.trim().toLocaleLowerCase('es'),
})
export async function searchYouTubeAlbums(query: string, cursor?: string): Promise<AlbumSearchResults> {
  const page = await albumSearches.page(query, cursor)
  return { albums: page.items, nextCursor: page.nextCursor }
}

export interface DiscoveryArtist {
  artist: YouTubeArtistRef
  similar: YouTubeArtistRef[]
  releases: YouTubeAlbum[]
  songs: YouTubeSong[]
}

/** Read actual discography and similar artists, rather than a popular-song radio. */
export async function getYouTubeDiscoveryArtist(reference: YouTubeArtistRef): Promise<DiscoveryArtist> {
  const id = reference.id && validArtistId(reference.id) ? reference.id
    : (await searchYouTubeArtists(reference.name)).artists.find(artist => artist.name.normalize('NFKC').toLocaleLowerCase('es') === reference.name.normalize('NFKC').toLocaleLowerCase('es'))?.id
  if (!id) return { artist: reference, similar: [], releases: [], songs: [] }
  const page = await artistPage(id), artist = artistMetadata(page, id)
  const refs = [{ id, name: artist.name }]
  const similar = similarArtists(page, id)
  const releaseItems = (['albums', 'singles'] as const).flatMap(kind => [...(artistSection(page.sections, kind)?.contents || [])])
  return { artist: refs[0]!, similar: similar.map(item => ({ id: item.id, name: item.name })),
    releases: normalizeAlbums(releaseItems as AlbumItems, refs),
    songs: normalizeSongs((artistSection(page.sections, 'songs')?.contents || []) as SongItems) }
}

function similarArtists(page: YTMusic.Artist, id: string) {
  return normalizeArtists(page.sections.flatMap(section => section instanceof YTNodes.MusicCarouselShelf ? [...section.contents] : []) as ArtistItems)
    .filter(artist => artist.id !== id)
}

export async function getYouTubeArtist(id: string): Promise<YouTubeArtistProfile> {
  const page = await artistPage(id)
  const artist = artistMetadata(page, id)
  const songSection = artistSection(page.sections, 'songs')
  const albumSection = artistSection(page.sections, 'albums')
  const singleSection = artistSection(page.sections, 'singles')
  const refs = [{ id, name: artist.name }]
  const initialAlbums = normalizeAlbums((albumSection?.contents || []) as AlbumItems, refs)
  const initialSingles = normalizeAlbums((singleSection?.contents || []) as AlbumItems, refs)
  const description = page.header && 'description' in page.header ? musicText(page.header.description) : ''
  let topSongs = normalizeSongs((songSection?.contents || []) as SongItems)
  // Artist shelves omit lengths (and sometimes the album). Their linked songs
  // playlist includes them and shares the same cache as “Ver todas las canciones”.
  // Match IDs, never titles.
  if (topSongs.some(song => song.duration === null || !song.album) && sectionEndpoint(songSection)?.payload.browseId) {
    try {
      const complete = new Map((await artistSongs.page(id)).items.map(song => [song.videoId, song]))
      topSongs = topSongs.map(song => {
        const full = complete.get(song.videoId)
        const albumId = song.albumId || (song.album ? undefined : full?.albumId)
        return { ...song, duration: song.duration ?? full?.duration ?? null, album: song.album || full?.album || null, ...(albumId ? { albumId } : {}) }
      })
    } catch (error) { logMusicFailure('artist-durations', id, error) }
  }
  return { ...artist, description: description || null, topSongs,
    albums: initialAlbums.slice(0, 6), singles: initialSingles.slice(0, 6), similar: similarArtists(page, id).slice(0, 12),
    expandable: { songs: !!sectionEndpoint(songSection), albums: initialAlbums.length > 6 || !!sectionEndpoint(albumSection), singles: initialSingles.length > 6 || !!sectionEndpoint(singleSection) } }
}
function playlistBatch(page: YTMusic.Playlist, album?: YouTubeAlbum): PageBatch<YouTubeSong> {
  return { items: normalizeSongs(page.items.filterType(YTNodes.MusicResponsiveListItem), album),
    next: page.has_continuation ? async () => playlistBatch(await page.getContinuation(), album) : null }
}
const artistSongs = new MusicPageCache<YouTubeSong>(async id => {
  const artist = await artistPage(id)
  const section = artistSection(artist.sections, 'songs')
  const endpoint = sectionEndpoint(section)
  if (!endpoint?.payload.browseId) return { items: normalizeSongs((section?.contents || []) as SongItems), next: null }
  return playlistBatch(await (await youtubeSession()).music.getPlaylist(endpoint.payload.browseId))
}, { initialSize: 20, nextSize: 10, identity: song => song.videoId })
export async function getYouTubeArtistSongs(id: string, cursor?: string): Promise<MusicSearchResults> {
  checkArtist(id)
  const page = await artistSongs.page(id, cursor)
  return { songs: page.items, nextCursor: page.nextCursor }
}

function browseItems(page: BrowsePage): { items: unknown[]; continuation?: string | null } {
  const continuation = page.continuation_contents as { contents?: unknown[]; items?: unknown[]; continuation?: string } | undefined
  if (continuation) return { items: continuation.contents || continuation.items || [], continuation: continuation.continuation }
  const grid = page.contents_memo?.getType(YTNodes.Grid)?.[0]
  if (grid) return { items: [...grid.contents], continuation: grid.continuation }
  const shelf = page.contents_memo?.getType(YTNodes.MusicShelf)?.[0]
  return { items: [...(shelf?.contents || [])], continuation: shelf?.continuation }
}
async function releaseBatch(page: BrowsePage, artist: YouTubeArtist): Promise<PageBatch<YouTubeAlbum>> {
  const batch = browseItems(page)
  return { items: normalizeAlbums(batch.items as AlbumItems, [{ id: artist.id, name: artist.name }]),
    next: batch.continuation ? async () => releaseBatch(await (await youtubeSession()).actions.execute('/browse', {
      client: 'YTMUSIC', continuation: batch.continuation, parse: true,
    }), artist) : null }
}
const releases = new MusicPageCache<YouTubeAlbum>(async key => {
  const [id, kind] = key.split(':') as [string, ReleaseKind]
  const page = await artistPage(id)
  const artist = artistMetadata(page, id)
  const section = artistSection(page.sections, kind)
  const endpoint = sectionEndpoint(section)
  if (!endpoint) return { items: normalizeAlbums((section?.contents || []) as AlbumItems, [{ id, name: artist.name }]), next: null }
  return releaseBatch(await endpoint.call<BrowsePage>((await youtubeSession()).actions, { client: 'YTMUSIC', parse: true }), artist)
}, { initialSize: 12, nextSize: 12, identity: album => album.id })
export async function getYouTubeArtistReleases(id: string, kind: ReleaseKind, cursor?: string): Promise<ArtistReleaseResults> {
  checkArtist(id)
  const page = await releases.page(`${id}:${kind}`, cursor)
  return { albums: page.items, nextCursor: page.nextCursor }
}

export function albumPlaylistId(value?: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const id = url.searchParams.get('list') || ''
    return url.protocol === 'https:' && url.hostname === 'music.youtube.com' && url.pathname === '/playlist'
      && /^OLAK5uy_[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null
  } catch { return null }
}

export async function getYouTubeAlbum(id: string): Promise<YouTubeAlbumDetail> {
  if (!validAlbumId(id)) throw new MusicProviderError('INVALID_ID', 'El identificador de álbum no es válido.', 400)
  return albums.get(id, async () => {
    const page = await (await youtubeSession()).music.getAlbum(id)
    const header = page.header
    const title = musicText(header?.title)
    if (!title) throw new MusicProviderError('NOT_FOUND', 'Este álbum no está disponible.', 404)
    const modern = header instanceof YTNodes.MusicResponsiveHeader ? header : undefined
    const classic = header instanceof YTNodes.MusicDetailHeader ? header : undefined
    const description = musicText(modern?.description?.description ?? classic?.description) || null
    const yearText = classic?.year || musicText(header?.subtitle).match(/\b\d{4}\b/)?.[0]
    const album: YouTubeAlbum = { id, title, artists: modern ? headerArtistReferences(modern.strapline_text_one) : artistReferences(classic?.author ? [classic.author] : []),
      artwork: musicArtwork(modern?.thumbnail?.contents || classic?.thumbnails), year: yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : null }
    // Album browse rows can point at an official music video while showing the
    // shorter album duration. The canonical playlist provides the actual audio IDs.
    const playlistId = albumPlaylistId(page.url)
    if (playlistId) {
      let batch = playlistBatch(await (await youtubeSession()).music.getPlaylist(playlistId), album)
      const songs: YouTubeSong[] = []
      const seen = new Set<string>()
      let emptyBatches = 0
      for (;;) {
        const before = songs.length
        for (const song of batch.items) if (!seen.has(song.videoId)) { songs.push(song); seen.add(song.videoId) }
        emptyBatches = songs.length === before ? emptyBatches + 1 : 0
        if (!batch.next) break
        if (emptyBatches >= 3) throw new MusicProviderError('SEARCH_STALLED', 'No se pudieron completar las pistas del álbum. Vuelve a intentarlo.')
        batch = await batch.next()
      }
      return { ...album, songs, description }
    }
    const songs = normalizeSongs(page.contents, album)
    const seen = new Set(songs.map(song => song.videoId))
    let continuation = page.page.contents_memo?.getType(YTNodes.MusicShelf)?.[0]?.continuation
    const tokens = new Set<string>()
    let emptyBatches = 0
    while (continuation) {
      if (tokens.has(continuation)) throw new MusicProviderError('SEARCH_STALLED', 'No se pudieron completar las pistas del álbum. Vuelve a intentarlo.')
      tokens.add(continuation)
      const next = browseItems(await (await youtubeSession()).actions.execute('/browse', { client: 'YTMUSIC', continuation, parse: true }))
      for (const song of normalizeSongs(next.items as SongItems, album)) if (!seen.has(song.videoId)) { songs.push(song); seen.add(song.videoId) }
      emptyBatches = next.items.length ? 0 : emptyBatches + 1
      if (emptyBatches >= 3 && next.continuation) throw new MusicProviderError('SEARCH_STALLED', 'No se pudieron completar las pistas del álbum. Vuelve a intentarlo.')
      continuation = next.continuation || undefined
    }
    return { ...album, songs, description }
  })
}
