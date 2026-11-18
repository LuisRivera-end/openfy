import type { NowPlaying, PlaybackEntry, PlaybackSnapshot, PlaybackSnapshotV2, Track } from '../types/music'

export const youtubeStreamUrl = (id: string) => `/api/music/youtube/${encodeURIComponent(id)}/stream`
export const playbackKey = (entry: PlaybackEntry) => entry.source === 'local' ? entry.trackId : `youtube:${entry.song.videoId}`

export function describePlayback(entry: PlaybackEntry | undefined, tracks: Map<string, Track>): NowPlaying | undefined {
  if (!entry) return
  if (entry.source === 'local') {
    const track = tracks.get(entry.trackId)
    return track ? { ...track, source: 'local' } : undefined
  }
  const song = entry.song
  return { id: playbackKey(entry), source: 'youtube', title: song.title, artist: song.artists.join(', ') || 'Artista desconocido',
    album: song.album || 'YouTube Music', artwork: song.artwork, duration: song.duration || 0,
    palette: ['#234d3b', '#273c4e', '#3e2849'], favorite: false, format: 'YouTube Music' }
}

/** Upgrade the old local-only snapshot without touching the library or downloads. */
export function restorePlayback(saved: PlaybackSnapshot | PlaybackSnapshotV2, tracks: Map<string, Track>): PlaybackSnapshotV2 {
  const entries: PlaybackEntry[] = 'version' in saved && saved.version === 2
    ? saved.queue : (saved as PlaybackSnapshot).queue.map(trackId => ({ source: 'local', trackId }))
  const selected = entries[saved.index]
  const queue = entries.filter(entry => entry.source === 'local' ? tracks.has(entry.trackId)
    : entry.source === 'youtube' && /^[\w-]{11}$/.test(entry.song?.videoId) && typeof entry.song.title === 'string' && Array.isArray(entry.song.artists))
  return { ...saved, version: 2, queue, index: selected ? Math.max(0, queue.indexOf(selected)) : 0 }
}
