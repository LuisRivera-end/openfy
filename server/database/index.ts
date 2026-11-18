import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import * as schema from './schema'
import { acquireLibraryLock, releaseLibraryLock } from '../utils/library-lock'

export function dataPaths() {
  const root = resolve(process.env.OPENFY_DATA_DIR || join(process.env.LOCALAPPDATA || homedir(), 'Openfy', 'data'))
  const paths = { root, originals: join(root, 'originals'), mobile: join(root, 'mobile'), artwork: join(root, 'artwork'), staging: join(root, 'staging') }
  for (const directory of Object.values(paths)) mkdirSync(directory, { recursive: true })
  return paths
}

let connection: Database.Database | undefined
let database: ReturnType<typeof drizzle<typeof schema>> | undefined

export function getDatabase() {
  if (database) return database
  const root = dataPaths().root
  acquireLibraryLock(root)
  try { connection = new Database(join(root, 'openfy.sqlite'), { fileMustExist: process.env.OPENFY_VERIFY_UPDATE === '1' }) }
  catch (error) { releaseLibraryLock(); throw error }
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')
  // Versioned, idempotent initial migration. Never replace an existing library.
  if (Number(connection.pragma('user_version', { simple: true })) < 1) {
    connection.transaction(() => {
      connection!.exec(`
        CREATE TABLE tracks (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE,
          metadata TEXT NOT NULL, original_id TEXT NOT NULL, mobile_id TEXT,
          favorite INTEGER NOT NULL DEFAULT 0, conversion TEXT NOT NULL,
          conversion_error TEXT, conversion_progress INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE assets (id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL,
          bytes INTEGER NOT NULL, hash TEXT NOT NULL, variant TEXT NOT NULL);
        CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL,
          track_ids TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
        CREATE TABLE imports (id TEXT PRIMARY KEY, filename TEXT NOT NULL,
          staging_path TEXT NOT NULL, state TEXT NOT NULL, track_id TEXT, error TEXT, created_at INTEGER NOT NULL);
        PRAGMA user_version = 1;
      `)
    })()
  }
  if (Number(connection.pragma('user_version', { simple: true })) < 2) {
    connection.transaction(() => {
      connection!.exec(`
        ALTER TABLE tracks ADD COLUMN embedded_lyrics TEXT;
        ALTER TABLE tracks ADD COLUMN lyrics_scanned INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE lyrics (key TEXT PRIMARY KEY, result TEXT NOT NULL);
        PRAGMA user_version = 2;
      `)
    })()
  }
  if (Number(connection.pragma('user_version', { simple: true })) < 3) {
    connection.transaction(() => {
      connection!.exec(`
        CREATE TABLE IF NOT EXISTS youtube_songs (video_id TEXT PRIMARY KEY, song TEXT NOT NULL,
          favorite INTEGER NOT NULL DEFAULT 0, added_at INTEGER NOT NULL);
        PRAGMA user_version = 3;
      `)
    })()
  }
  if (Number(connection.pragma('user_version', { simple: true })) < 4) {
    connection.transaction(() => {
      const columns = connection!.pragma('table_info(tracks)') as { name: string }[]
      if (!columns.some(column => column.name === 'genres_scanned')) connection!.exec('ALTER TABLE tracks ADD COLUMN genres_scanned INTEGER NOT NULL DEFAULT 0')
      connection!.exec(`
        CREATE TABLE IF NOT EXISTS listening_sessions (id TEXT PRIMARY KEY, track_key TEXT NOT NULL, snapshot TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS listening_sessions_track ON listening_sessions(track_key);
        CREATE TABLE IF NOT EXISTS listening_days (key TEXT PRIMARY KEY, track_key TEXT NOT NULL, day TEXT NOT NULL,
          listened_ms INTEGER NOT NULL DEFAULT 0, plays INTEGER NOT NULL DEFAULT 0, last_played_at INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS listening_days_period ON listening_days(day, track_key);
        CREATE TABLE IF NOT EXISTS recommendation_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 4;
      `)
    })()
  }
  if (Number(connection.pragma('user_version', { simple: true })) < 5) {
    connection.transaction(() => {
      connection!.exec(`
        CREATE TABLE IF NOT EXISTS youtube_audio (video_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL,
          duration REAL NOT NULL, artwork TEXT, palette TEXT NOT NULL, downloaded_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS audio_downloads (id TEXT PRIMARY KEY, video_id TEXT NOT NULL UNIQUE,
          song TEXT NOT NULL, state TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0, error TEXT, error_code TEXT, suppressed INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS offline_collections (key TEXT PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL,
          title TEXT NOT NULL, artwork TEXT, entries TEXT NOT NULL, revision INTEGER, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        PRAGMA user_version = 5;
      `)
    })()
  }
  if (Number(connection.pragma('user_version', { simple: true })) < 6) {
    connection.transaction(() => {
      connection!.exec(`
        CREATE TABLE IF NOT EXISTS sync_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL DEFAULT 0, last_sequence INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sync_entities (kind TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0, payload TEXT, PRIMARY KEY(kind,entity_id));
        CREATE TABLE IF NOT EXISTS sync_changes (cursor INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
          entity_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL, payload TEXT, device_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_operations (device_id TEXT NOT NULL, operation_id TEXT NOT NULL, sequence INTEGER NOT NULL,
          fingerprint TEXT NOT NULL, acknowledgement TEXT NOT NULL, PRIMARY KEY(device_id,operation_id), UNIQUE(device_id,sequence));
        CREATE TABLE IF NOT EXISTS sync_local_playlists (id TEXT PRIMARY KEY);
        PRAGMA user_version = 6;
      `)
    })()
  }
  database = drizzle(connection, { schema })
  return database
}

export function librarySchema() { getDatabase(); return Number(connection!.pragma('user_version', { simple: true })) }
/** Internal transaction owner for the portable synchronization journal. Never expose this over HTTP. */
export function libraryConnection() { getDatabase(); return connection! }

export function closeDatabase() {
  connection?.close()
  connection = undefined
  database = undefined
  releaseLibraryLock()
}
