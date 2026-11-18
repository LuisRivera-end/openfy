import type { YouTubeAlbum, YouTubeArtist, YouTubeArtistRef, YouTubeSong } from '../../shared/types/music'

export const isMusicVideoId = (value: string) => /^[A-Za-z0-9_-]{11}$/.test(value)
export const validArtistId = (value: string) => /^UC[A-Za-z0-9_-]{22}$/.test(value)
export const validAlbumId = (value: string) => /^MPR[A-Za-z0-9_-]{1,125}$/.test(value)
type TextValue = string | { text?: string; toString?: () => string }
export const musicText = (value?: TextValue | null) => typeof value === 'string' ? value.trim() : value?.text?.trim() || ''
type Image = { url: string; width?: number }
export function musicArtwork(images?: readonly Image[] | null): string | null {
  return [...(images || [])].sort((a, b) => (b.width || 0) - (a.width || 0)).find(image => /^https:\/\//.test(image.url))?.url || null
}
type ProviderArtist = { name: string; channel_id?: string; endpoint?: { payload: { browseId?: string } } }
export function artistReferences(artists?: ProviderArtist[]): YouTubeArtistRef[] {
  const seen = new Set<string>()
  return (artists || []).flatMap(artist => {
    const name = artist.name.trim()
    const candidate = artist.channel_id || artist.endpoint?.payload.browseId || ''
    const id = validArtistId(candidate) ? candidate : null
    const key = id || name
    if (!name || seen.has(key)) return []
    seen.add(key)
    return [{ id, name }]
  })
}
export function headerArtistReferences(label?: { text?: string; runs?: { text: string; endpoint?: { payload: { browseId?: string } } }[] }): YouTubeArtistRef[] {
  const linked = artistReferences(label?.runs?.flatMap(run => {
    const id = run.endpoint?.payload.browseId
    return id && validArtistId(id) ? [{ name: run.text, channel_id: id }] : []
  }))
  // Header runs also contain punctuation and localized conjunctions, not artists.
  return linked.length ? linked : artistReferences(label?.text ? [{ name: label.text }] : [])
}
type TextRun = { text?: string; endpoint?: { payload?: { browseId?: string } } }
type SongItem = {
  id?: string; item_type?: string; title?: string; artists?: ProviderArtist[]; author?: ProviderArtist
  album?: { id?: string; name: string }; thumbnails?: Image[]; duration?: { seconds: number }
  flex_columns?: readonly { title?: { runs?: readonly TextRun[] } }[]
}
/**
 * youtubei.js only reads the album from the second and third columns. Artist
 * "popular songs" rows place it after the play count, so look at every column
 * for the run that links to an album.
 */
function songAlbum(item: SongItem): { id?: string; name: string } | undefined {
  if (item.album?.name?.trim()) return item.album
  for (const column of item.flex_columns || []) {
    const run = column.title?.runs?.find(run => run.endpoint?.payload?.browseId?.startsWith('MPR') && run.text?.trim())
    if (run) return { id: run.endpoint!.payload!.browseId, name: run.text!.trim() }
  }
  return undefined
}
export function normalizeCatalogSongs(items: SongItem[], album?: YouTubeAlbum): YouTubeSong[] {
  const seen = new Set<string>()
  return items.flatMap(item => {
    if (!item.id || !isMusicVideoId(item.id) || !item.title?.trim() || (item.item_type !== 'song' && !(album && item.item_type === 'video')) || seen.has(item.id)) return []
    seen.add(item.id)
    const refs = artistReferences(item.artists?.length ? item.artists : item.author ? [item.author] : undefined)
    const artists = refs.length ? refs : album?.artists || []
    const itemAlbum = songAlbum(item)
    const albumId = itemAlbum?.id && validAlbumId(itemAlbum.id) ? itemAlbum.id : album?.id
    return [{ videoId: item.id, title: item.title.trim(), artists: [...new Set(artists.map(artist => artist.name))],
      album: itemAlbum?.name || album?.title || null, artwork: musicArtwork(item.thumbnails) || album?.artwork || null,
      duration: Number.isFinite(item.duration?.seconds) && item.duration!.seconds > 0 ? item.duration!.seconds : null,
      ...(artists.some(artist => artist.id) ? { artistRefs: artists } : {}), ...(albumId ? { albumId } : {}),
    }]
  })
}
type ArtistItem = { id?: string; item_type?: string; name?: string; title?: TextValue; thumbnails?: Image[]; thumbnail?: Image[] }
export function normalizeArtists(items: ArtistItem[]): YouTubeArtist[] {
  const seen = new Set<string>()
  return items.flatMap(item => {
    const name = item.name?.trim() || musicText(item.title)
    if (item.item_type !== 'artist' || !item.id || !validArtistId(item.id) || !name || seen.has(item.id)) return []
    seen.add(item.id)
    return [{ id: item.id, name, artwork: musicArtwork(item.thumbnails || item.thumbnail) }]
  })
}
// Carousel releases carry an image array; search rows carry a MusicThumbnail and a single author.
type AlbumItem = { id?: string; item_type?: string; title?: TextValue; artists?: ProviderArtist[]; author?: ProviderArtist; year?: string; thumbnail?: Image[] | { contents?: Image[] }; thumbnails?: Image[] }
export function normalizeAlbums(items: AlbumItem[], fallbackArtists: YouTubeArtistRef[] = []): YouTubeAlbum[] {
  const seen = new Set<string>()
  return items.flatMap(item => {
    const title = musicText(item.title)
    if (item.item_type !== 'album' || !item.id || !validAlbumId(item.id) || !title || seen.has(item.id)) return []
    seen.add(item.id)
    const artists = artistReferences(item.artists?.length ? item.artists : item.author ? [item.author] : undefined)
    const images = Array.isArray(item.thumbnail) ? item.thumbnail : item.thumbnail?.contents || item.thumbnails
    return [{ id: item.id, title, artists: artists.length ? artists : fallbackArtists,
      artwork: musicArtwork(images), year: /^\d{4}$/.test(item.year || '') ? Number(item.year) : null }]
  })
}
