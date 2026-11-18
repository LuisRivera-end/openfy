import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { Asset, ImportJob, Track, YouTubeSong, AudioDownloadJob, OfflineCollection } from '../../shared/types/music'
import type { LyricsContent, LyricsResult } from '../../shared/types/lyrics'
import type { ListeningSession } from '../../shared/types/telemetry'

type Metadata = Omit<Track, 'original' | 'mobile' | 'favorite' | 'conversion' | 'conversionError' | 'conversionProgress'>

export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  hash: text('hash').notNull().unique(),
  metadata: text('metadata', { mode: 'json' }).$type<Metadata>().notNull(),
  originalId: text('original_id').notNull(),
  mobileId: text('mobile_id'),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
  conversion: text('conversion').$type<Track['conversion']>().notNull(),
  conversionError: text('conversion_error'),
  conversionProgress: integer('conversion_progress').notNull().default(0),
  embeddedLyrics: text('embedded_lyrics', { mode: 'json' }).$type<LyricsContent>(),
  lyricsScanned: integer('lyrics_scanned', { mode: 'boolean' }).notNull().default(false),
  genresScanned: integer('genres_scanned', { mode: 'boolean' }).notNull().default(false),
})

export const lyrics = sqliteTable('lyrics', {
  key: text('key').primaryKey(),
  result: text('result', { mode: 'json' }).$type<LyricsResult>().notNull(),
})

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  hash: text('hash').notNull(),
  variant: text('variant').$type<Asset['variant']>().notNull(),
})

export const playlists = sqliteTable('playlists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  trackIds: text('track_ids', { mode: 'json' }).$type<string[]>().notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
})

// Stable catalog identity, optionally associated with a verified local asset.
export const youtubeSongs = sqliteTable('youtube_songs', {
  videoId: text('video_id').primaryKey(),
  song: text('song', { mode: 'json' }).$type<YouTubeSong>().notNull(),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
  addedAt: integer('added_at').notNull(),
})

export const youtubeAudio = sqliteTable('youtube_audio', {
  videoId: text('video_id').primaryKey(),
  assetId: text('asset_id').notNull(),
  duration: real('duration').notNull(),
  artwork: text('artwork'),
  palette: text('palette', { mode: 'json' }).$type<string[]>().notNull(),
  downloadedAt: integer('downloaded_at').notNull(),
})

export const audioDownloads = sqliteTable('audio_downloads', {
  id: text('id').primaryKey(), videoId: text('video_id').notNull().unique(),
  song: text('song', { mode: 'json' }).$type<YouTubeSong>().notNull(),
  state: text('state').$type<AudioDownloadJob['state']>().notNull(),
  bytes: integer('bytes').notNull().default(0), total: integer('total').notNull().default(0),
  attempts: integer('attempts').notNull().default(0), error: text('error'), errorCode: text('error_code'),
  suppressed: integer('suppressed', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
})

export const offlineCollections = sqliteTable('offline_collections', {
  key: text('key').primaryKey(), kind: text('kind').$type<OfflineCollection['kind']>().notNull(),
  id: text('id').notNull(), title: text('title').notNull(), artwork: text('artwork'),
  entries: text('entries', { mode: 'json' }).$type<OfflineCollection['entries']>().notNull(),
  revision: integer('revision'), enabled: integer('enabled', { mode: 'boolean' }).notNull(), updatedAt: integer('updated_at').notNull(),
})

export const imports = sqliteTable('imports', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  stagingPath: text('staging_path').notNull(),
  state: text('state').$type<ImportJob['state']>().notNull(),
  trackId: text('track_id'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
})

export const listeningSessions = sqliteTable('listening_sessions', {
  id: text('id').primaryKey(),
  trackKey: text('track_key').notNull(),
  snapshot: text('snapshot', { mode: 'json' }).$type<ListeningSession>().notNull(),
})
export const listeningDays = sqliteTable('listening_days', {
  key: text('key').primaryKey(), trackKey: text('track_key').notNull(), day: text('day').notNull(),
  listenedMs: integer('listened_ms').notNull().default(0), plays: integer('plays').notNull().default(0),
  lastPlayedAt: integer('last_played_at').notNull().default(0),
})
export const recommendationCache = sqliteTable('recommendation_cache', {
  key: text('key').primaryKey(), value: text('value', { mode: 'json' }).$type<import('../../shared/types/telemetry').Recommendations>().notNull(),
})
