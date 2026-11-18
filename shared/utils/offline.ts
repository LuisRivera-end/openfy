import type { Asset, Library, OfflineCollection, PlaybackEntry } from '../types/music'
import { playbackKey } from './playback'

export function downloadTarget(entry: PlaybackEntry, library: Library): { id: string; entry: PlaybackEntry; artwork: string | null; asset: Asset } | null {
  if (entry.source === 'local') {
    const track = library.tracks.find(track => track.id === entry.trackId)
    return track?.mobile ? { id: track.id, entry, artwork: track.artwork, asset: track.mobile } : null
  }
  const saved = library.youtubeSongs?.find(saved => saved.song.videoId === entry.song.videoId)
  return saved?.localAudio ? { id: playbackKey(entry), entry, artwork: saved.localAudio.artwork, asset: saved.localAudio.asset } : null
}

export function collectionProgress(collection: OfflineCollection | undefined, ready: Set<string>) {
  const ids = new Set(collection?.entries.map(playbackKey) || [])
  const completed = [...ids].filter(id => ready.has(id)).length
  return { completed, total: ids.size, ready: ids.size > 0 && completed === ids.size }
}
