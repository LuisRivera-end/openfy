import type { LibraryItem, PlaybackEntry, YouTubeAlbum, YouTubeSong } from './music'

export type ListeningPeriod = '7d' | '30d' | 'year' | 'all'
export type ListeningContext =
  | { kind: 'song' }
  | { kind: 'favorites' }
  | { kind: 'playlist'; id: string }
  | { kind: 'album' | 'artist'; id: string; title: string; subtitle: string; artwork?: string | null }
export interface ListeningSession {
  id: string
  deviceId: string
  sequence: number
  entry: PlaybackEntry
  startedAt: number
  updatedAt: number
  durationMs: number | null
  listenedMs: number
  days: Record<string, number>
  qualifiedAt: number | null
  context?: ListeningContext
}
export interface TrackStatistics { listenedMs: number; plays: number; lastPlayedAt: number }
export interface ListeningStats extends TrackStatistics {
  period: ListeningPeriod
  byTrack: Record<string, TrackStatistics>
}
export interface RankedTrack extends TrackStatistics { item: LibraryItem }
export interface MostPlayedPage { items: RankedTrack[]; total: number; offset: number; limit: number }
export interface RecentCard {
  kind: ListeningContext['kind']; key: string; id: string | null
  title: string; subtitle: string; artwork: string | null; lastPlayedAt: number; item: LibraryItem | null
}
export interface RecentListening { items: RecentCard[] }
export interface Recommendations { songs: YouTubeSong[]; generatedAt: number; stale: boolean; error: string | null; releases?: YouTubeAlbum[]; algorithmVersion?: number }
export interface ListeningAcknowledgement { accepted: { id: string; sequence: number }[] }
export type LibrarySort = 'default' | 'title' | 'artist' | 'album' | 'genre' | 'favorite' | 'duration' | 'plays' | 'minutes' | 'addedAt'
export interface LibraryFilters {
  query: string; artist: string; album: string; genre: string
  favorite: boolean; source: 'all' | 'local' | 'youtube'; downloaded: boolean
  sort: LibrarySort; direction: 'asc' | 'desc'
}
