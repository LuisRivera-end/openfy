import type { LibraryItem, SavedYouTubeSong, Track } from '../types/music'
import { describePlayback } from './playback'

export function collectionMap(tracks: Track[], saved: SavedYouTubeSong[] = []) {
  const locals = new Map(tracks.map(track => [track.id, track]))
  const items = new Map<string, LibraryItem>()
  for (const track of tracks) {
    const entry = { source: 'local' as const, trackId: track.id }
    items.set(track.id, { ...describePlayback(entry, locals)!, entry, addedAt: track.addedAt, albumId: track.albumId, genres: track.genres || [] })
  }
  for (const record of saved) {
    const entry = { source: 'youtube' as const, song: record.song }
    const item = { ...describePlayback(entry, locals)!, favorite: record.favorite, entry, addedAt: record.addedAt, albumId: record.song.albumId || undefined, genres: record.song.genres || [] }
    if (record.localAudio) Object.assign(item, { duration: record.localAudio.duration, artwork: record.localAudio.artwork, palette: record.localAudio.palette, format: 'AAC' })
    items.set(item.id, item)
  }
  return items
}
