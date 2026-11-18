import type { LibraryItem, YouTubeSong } from '../types/music'
import { normalizeLibraryText } from './library-filters'

export const DISCOVERY_VERSION = 2

/** Audio/video uploads and remasters must not reintroduce an already known song. */
export function discoveryTitle(value: string) {
  return normalizeLibraryText(value)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(?:feat\.?|ft\.?|featuring)\b.*$/i, '')
    .replace(/\b(?:official|oficial|audio|video|lyrics?|letra|visualizer|remaster(?:ed)?|version|single|deluxe|edition|anniversary|sped up|slowed|reverb)\b/gi, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
export function discoveryArtist(value: string) {
  return normalizeLibraryText(value).replace(/\s*-\s*topic$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
export function discoveryArtistKeys(song: Pick<YouTubeSong, 'artists' | 'artistRefs'>) {
  return [...new Set([...song.artists.map(discoveryArtist), ...(song.artistRefs || []).flatMap(artist => artist.id ? ['id:' + artist.id] : [])])]
}
export function songIdentities(song: Pick<YouTubeSong, 'title' | 'artists' | 'artistRefs'>) {
  return discoveryArtistKeys(song).map(artist => `${artist}\u001f${discoveryTitle(song.title)}`)
}
export function knownMusic(items: LibraryItem[]) {
  const ids = new Set<string>(), songs = new Set<string>(), artists = new Set<string>(), albums = new Set<string>()
  for (const item of items) {
    ids.add(item.id)
    const names = item.entry.source === 'youtube' ? discoveryArtistKeys(item.entry.song) : item.artist.split(/,\s*|;\s*/).map(discoveryArtist)
    for (const name of names) {
      const artist = name
      artists.add(artist); songs.add(`${artist}\u001f${discoveryTitle(item.title)}`)
      if (item.album && item.album !== 'YouTube Music') albums.add(`${artist}\u001f${discoveryTitle(item.album)}`)
    }
    if (item.albumId) albums.add(item.albumId)
  }
  return { ids, songs, artists, albums }
}
export function isUnknownSong(song: YouTubeSong, known: ReturnType<typeof knownMusic>) {
  return !known.ids.has(`youtube:${song.videoId}`) && !songIdentities(song).some(key => known.songs.has(key))
}
