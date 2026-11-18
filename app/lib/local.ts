import Dexie, { type Table } from 'dexie'
import type { DownloadRecord, PlaybackEvent, OfflineCollection } from '../../shared/types/music'
import type { LyricsResult } from '../../shared/types/lyrics'
import type { ListeningSession } from '../../shared/types/telemetry'

class LocalDatabase extends Dexie {
  snapshots!: Table<{ key: string; value: unknown }, string>
  downloads!: Table<DownloadRecord, string>
  events!: Table<PlaybackEvent & { id?: number }, number>
  lyrics!: Table<LyricsResult, string>
  listening!: Table<ListeningSession, string>
  offlineCollections!: Table<OfflineCollection, string>
  downloadExclusions!: Table<{ key: string }, string>
  constructor() {
    super('openfy')
    this.version(1).stores({ snapshots: 'key', downloads: 'trackId', events: '++id,at' })
    this.version(2).stores({ lyrics: 'key,expiresAt' })
    this.version(3).stores({ listening: 'id,updatedAt' })
    this.version(4).stores({ offlineCollections: 'key', downloadExclusions: 'key' })
  }
}
let database: LocalDatabase | undefined
export function localDatabase() { return database ||= new LocalDatabase() }
export async function readLocal<T>(key: string): Promise<T | undefined> {
  return (await localDatabase().snapshots.get(key))?.value as T | undefined
}
export async function writeLocal(key: string, value: unknown) {
  await localDatabase().snapshots.put({ key, value: JSON.parse(JSON.stringify(value)) })
}
