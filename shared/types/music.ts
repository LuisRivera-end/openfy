import type { ListeningContext } from './telemetry'

export interface Asset {
  id: string
  mime: string
  bytes: number
  hash: string
  variant: 'original' | 'mobile'
}

export interface Track {
  genres?: string[]
  id: string
  title: string
  artist: string
  albumArtist: string
  album: string
  albumId: string
  duration: number
  trackNumber: number
  disc: number
  year: number | null
  format: string
  artwork: string | null
  palette: string[]
  original: Asset
  mobile: Asset | null
  conversion: 'ready' | 'pending' | 'running' | 'failed'
  conversionError: string | null
  conversionProgress: number
  favorite: boolean
  addedAt: number
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  revision: number
  updatedAt: number
}

export interface Library {
  tracks: Track[]
  playlists: Playlist[]
  youtubeSongs?: SavedYouTubeSong[]
}

export interface SavedYouTubeSong {
  song: YouTubeSong
  favorite: boolean
  addedAt: number
  localAudio?: StoredYouTubeAudio | null
}

export interface StoredYouTubeAudio {
  asset: Asset
  duration: number
  artwork: string | null
  palette: string[]
  downloadedAt: number
}

export interface AudioDownloadJob {
  id: string
  videoId: string
  song: YouTubeSong
  state: 'queued' | 'downloading' | 'processing' | 'ready' | 'failed' | 'cancelled' | 'removed'
  bytes: number
  total: number
  attempts: number
  error: string | null
  errorCode: string | null
  suppressed: boolean
  createdAt: number
  updatedAt: number
}

export interface OfflineCollection {
  key: string
  kind: 'album' | 'playlist'
  id: string
  title: string
  artwork: string | null
  entries: PlaybackEntry[]
  revision: number | null
  enabled: boolean
  updatedAt: number
}

export interface LibraryItem extends NowPlaying { entry: PlaybackEntry; addedAt?: number; albumId?: string }

export interface Album {
  id: string
  title: string
  artist: string
  artwork: string | null
  palette: string[]
  trackIds: string[]
}

export interface Artist { name: string; trackIds: string[]; artwork: string | null }

export interface ImportJob {
  id: string
  filename: string
  state: 'processing' | 'complete' | 'duplicate' | 'failed'
  trackId: string | null
  error: string | null
  createdAt: number
}

export interface DownloadRecord {
  trackId: string
  assetId: string
  state: 'preparing' | 'queued' | 'downloading' | 'ready' | 'error'
  bytes: number
  total: number
  error: string | null
  updatedAt: number
  entry?: PlaybackEntry
  artwork?: string | null
  attempts?: number
  manual?: boolean
}

export interface PlaybackSnapshot {
  queue: string[]
  index: number
  position: number
  repeat: 'off' | 'all' | 'one'
  shuffle: boolean
  volume: number
}

export interface YouTubeSong {
  genres?: string[]
  videoId: string
  title: string
  artists: string[]
  album: string | null
  artwork: string | null
  duration: number | null
  artistRefs?: YouTubeArtistRef[]
  albumId?: string | null
}

export interface MusicSearchResults { songs: YouTubeSong[]; nextCursor: string | null }

export interface YouTubeArtistRef { id: string | null; name: string }
export interface YouTubeArtist { id: string; name: string; artwork: string | null }
export interface ArtistSearchResults { artists: YouTubeArtist[]; nextCursor: string | null }
export interface YouTubeAlbum {
  id: string
  title: string
  artists: YouTubeArtistRef[]
  artwork: string | null
  year: number | null
}
export interface AlbumSearchResults { albums: YouTubeAlbum[]; nextCursor: string | null }
export interface YouTubeArtistProfile extends YouTubeArtist {
  /** Wide header image, when the provider has one; `artwork` is the portrait. */
  banner: string | null
  description: string | null
  similar: YouTubeArtist[]
  topSongs: YouTubeSong[]
  albums: YouTubeAlbum[]
  singles: YouTubeAlbum[]
  expandable: { songs: boolean; albums: boolean; singles: boolean }
}
export interface YouTubeAlbumDetail extends YouTubeAlbum { songs: YouTubeSong[] }
export interface ArtistReleaseResults { albums: YouTubeAlbum[]; nextCursor: string | null }

export type PlaybackEntry = ({ source: 'local'; trackId: string } | { source: 'youtube'; song: YouTubeSong }) & { queueId?: string; context?: ListeningContext }

export interface PlaybackSnapshotV2 extends Omit<PlaybackSnapshot, 'queue'> {
  version: 2
  queue: PlaybackEntry[]
}
export interface PlaybackSnapshotV3 extends Omit<PlaybackSnapshotV2, 'version'> {
  version: 3
  originalOrder: string[]
}

export type NowPlaying = Pick<Track, 'id' | 'title' | 'artist' | 'album' | 'artwork' | 'palette' | 'duration' | 'favorite' | 'format'> & {
  genres?: string[]
  source: 'local' | 'youtube'
}

/** The looping video that replaces the cover in the desktop Big Picture, when the album has one. */
export type MotionArtResult = { status: 'ready'; url: string; width: number; height: number }
  | { status: 'none'; retryAfterMs?: number } | { status: 'unmatched'; retryAfterMs: number }

export interface PlaybackEvent {
  at: number
  type: string
  trackId: string | null
  position: number
  visibility: string
  detail?: string
}
