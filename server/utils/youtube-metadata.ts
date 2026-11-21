import { eq, sql } from 'drizzle-orm'
import { YTNodes } from 'youtubei.js'
import { getDatabase } from '../database'
import { youtubeSongs } from '../database/schema'
import type { YouTubeSong } from '../../shared/types/music'
import { metadataKey, sameArtist } from '../../shared/utils/metadata-key'
import { notifyDesktop } from './desktop-events'
import { validAlbumId } from './music-normalize'
import { youtubeSession } from './youtube-music'

export { artistParts, metadataKey, sameArtist } from '../../shared/utils/metadata-key'

/**
 * YouTube Music exposes no genre, and some catalog rows omit the album. Saved
 * songs are completed once, in the background: the album from YouTube's own
 * queue panel, the genre from the iTunes Search API (Mexican storefront, so the
 * names are in Spanish). Only title, artist and album names leave the server.
 * A song is done once `genres` is present, even when empty: a song nobody lists
 * keeps «Sin género» instead of being looked up on every start.
 */

export class MetadataProviderError extends Error {}

type ITunesResult = { wrapperType?: string; kind?: string; artistId?: number; artistName?: string; trackName?: string; collectionName?: string; primaryGenreName?: string }
type Fetcher = typeof fetch

const STORE = 'mx'
// iTunes Search allows roughly 20 requests a minute; a song costs one to three.
const SPACING = 3200
const RETRY_AFTER = 10 * 60000

const genreOf = (result?: ITunesResult) => result?.primaryGenreName?.trim() ? [result.primaryGenreName.trim()] : []

function touchLru<K, V>(map: Map<K, V>, key: K, value: V, max = 200) {
  map.delete(key)
  map.set(key, value)
  if (map.size > max) map.delete(map.keys().next().value!)
}

export class ITunesGenres {
  private artists = new Map<string, Promise<{ id: number | null; genres: string[] }>>()
  private albums = new Map<number, Promise<ITunesResult[]>>()
  private requests = 0
  constructor(private fetcher: Fetcher = fetch) {}

  /** Requests sent since the last call, so the caller can pace the next song. */
  takeRequests() { const count = this.requests; this.requests = 0; return count }

  private async request(path: 'search' | 'lookup', params: Record<string, string>): Promise<ITunesResult[]> {
    const url = new URL(`https://itunes.apple.com/${path}`)
    for (const [key, value] of Object.entries({ ...params, country: STORE })) url.searchParams.set(key, value)
    this.requests++
    let response: Response
    try { response = await this.fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) }) }
    catch { throw new MetadataProviderError('iTunes unavailable') }
    if (!response.ok) throw new MetadataProviderError(`iTunes HTTP ${response.status}`)
    const body = await response.json().catch(() => null) as { results?: ITunesResult[] } | null
    if (!Array.isArray(body?.results)) throw new MetadataProviderError('iTunes response')
    return body.results
  }

  private artist(name: string) {
    const key = metadataKey(name)
    let pending = this.artists.get(key)
    if (pending) touchLru(this.artists, key, pending)
    else {
      pending = this.request('search', { term: name, media: 'music', entity: 'musicArtist', limit: '10' }).then(results => {
        const found = results.find(result => result.wrapperType === 'artist' && metadataKey(result.artistName || '') === key)
        return { id: found?.artistId ?? null, genres: genreOf(found) }
      })
      pending.catch(() => this.artists.delete(key))
      touchLru(this.artists, key, pending)
    }
    return pending
  }

  private releases(artistId: number) {
    let pending = this.albums.get(artistId)
    if (pending) touchLru(this.albums, artistId, pending)
    else {
      pending = this.request('lookup', { id: String(artistId), entity: 'album', limit: '200' }).then(results => results.filter(result => result.wrapperType === 'collection'))
      pending.catch(() => this.albums.delete(artistId))
      touchLru(this.albums, artistId, pending)
    }
    return pending
  }

  /**
   * The recording's own genre first; then its album's; then the main artist's.
   * Returns [] when nothing matches. Throws only when the provider fails.
   */
  async genres(song: Pick<YouTubeSong, 'title' | 'artists' | 'album'>): Promise<string[]> {
    const main = song.artists[0]
    if (!main) return []
    const title = metadataKey(song.title)
    const tracks = await this.request('search', { term: `${song.title} ${main}`, media: 'music', entity: 'song', limit: '25' })
    const track = tracks.find(result => result.kind === 'song' && metadataKey(result.trackName || '') === title && sameArtist(result, song.artists))
    if (genreOf(track).length) return genreOf(track)
    const artist = await this.artist(main)
    if (artist.id !== null && song.album) {
      const album = metadataKey(song.album)
      const release = (await this.releases(artist.id)).find(result => metadataKey(result.collectionName || '') === album)
      if (genreOf(release).length) return genreOf(release)
    }
    return artist.genres
  }
}

/** The queue panel for a video lists the video itself first, with its album. */
export async function youtubeSongAlbum(videoId: string): Promise<{ album: string; albumId?: string } | null> {
  const panel = await (await youtubeSession()).music.getUpNext(videoId, false)
  const item = panel.contents.filterType(YTNodes.PlaylistPanelVideo).find(video => video.video_id === videoId)
  const name = item?.album?.name?.trim()
  if (!name) return null
  return { album: name, ...(item!.album!.id && validAlbumId(item!.album!.id) ? { albumId: item!.album!.id } : {}) }
}

let provider = new ITunesGenres()
let readyAt = 0
export function setMetadataProvider(next: ITunesGenres) { provider = next; readyAt = 0 }

function nextSong() {
  return getDatabase().select({ song: youtubeSongs.song }).from(youtubeSongs)
    .where(sql`json_type(${youtubeSongs.song}, '$.genres') IS NOT 'array'`).limit(1).get()?.song
}

/** Milliseconds until the next song can be completed, or null when none is waiting. */
export function youtubeMetadataDelay(now = Date.now()) {
  // Tests and isolated runs can opt out of third-party lookups.
  if (process.env.OPENFY_METADATA_LOOKUP === 'off') return null
  return nextSong() ? Math.max(0, readyAt - now) : null
}

let changed: string[] = []
let notifiedAt = 0
/** A large library completes over minutes; refresh clients in batches, not per song. */
function flushChanges(now: number, force: boolean) {
  if (!changed.length || (!force && now - notifiedAt < 30000)) return
  notifyDesktop('libraryChanged', { trackIds: changed })
  changed = []
  notifiedAt = now
}

export async function completeNextYouTubeSong(now = Date.now) {
  const song = nextSong()
  if (!song) return
  readyAt = now() + SPACING
  try {
    const album = song.album ? null : await youtubeSongAlbum(song.videoId).catch(() => null)
    const genres = await provider.genres({ ...song, album: song.album || album?.album || null })
    readyAt = now() + SPACING * Math.max(1, provider.takeRequests())
    // Re-read after network IO so a concurrent save or edit is not lost.
    const db = getDatabase()
    const current = db.select({ song: youtubeSongs.song }).from(youtubeSongs).where(eq(youtubeSongs.videoId, song.videoId)).get()?.song
    if (!current) return
    const next: YouTubeSong = { ...current, genres: current.genres?.length ? current.genres : genres,
      ...(!current.album && album ? { album: album.album, ...(album.albumId ? { albumId: album.albumId } : {}) } : {}) }
    db.update(youtubeSongs).set({ song: next }).where(eq(youtubeSongs.videoId, song.videoId)).run()
    changed.push(`youtube:${song.videoId}`)
    flushChanges(now(), !nextSong())
  } catch (error) {
    // Offline, rate limited or an unexpected answer: try again later, never in a tight loop.
    provider.takeRequests()
    readyAt = now() + RETRY_AFTER
    flushChanges(now(), true)
    console.warn('[youtube-metadata]', error instanceof Error ? error.message : 'failed')
  }
}
