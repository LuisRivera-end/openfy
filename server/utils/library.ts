import { eq, desc } from 'drizzle-orm'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { getDatabase, dataPaths } from '../database'
import { assets, imports, playlists, tracks, youtubeSongs, youtubeAudio } from '../database/schema'
import type { Asset, ImportJob, Library, Track, StoredYouTubeAudio } from '../../shared/types/music'
import { readStoredAudioAsync } from './stored-audio'

export async function readLibraryAsync(): Promise<Library> { return readLibrary(await readStoredAudioAsync()) }

export function readLibrary(verifiedAudio?: Map<string, StoredYouTubeAudio>): Library {
  const db = getDatabase()
  const rows = db.select().from(assets).all(), paths = dataPaths()
  const filenames = new Map(rows.map(asset => [asset.id, asset.filename]))
  const assetMap = new Map(rows.map(({ filename: _filename, ...asset }) => [asset.id, asset]))
  const audioMap = verifiedAudio ?? new Map(db.select().from(youtubeAudio).all().flatMap(audio => {
    const asset = assetMap.get(audio.assetId)
    try { if (!asset || statSync(join(paths.originals, filenames.get(asset.id)!)).size !== asset.bytes) return [] } catch { return [] }
    return asset ? [[audio.videoId, { asset, duration: audio.duration, artwork: audio.artwork, palette: audio.palette, downloadedAt: audio.downloadedAt }] as const] : []
  }))
  return {
    tracks: db.select().from(tracks).all().map(row => ({
      ...row.metadata,
      original: assetMap.get(row.originalId) as Asset,
      mobile: row.mobileId ? assetMap.get(row.mobileId) || null : null,
      favorite: row.favorite,
      conversion: row.conversion,
      conversionError: row.conversionError,
      conversionProgress: row.conversionProgress,
    })).sort((a, b) => b.addedAt - a.addedAt),
    playlists: db.select().from(playlists).orderBy(desc(playlists.updatedAt)).all(),
    youtubeSongs: db.select({ song: youtubeSongs.song, favorite: youtubeSongs.favorite, addedAt: youtubeSongs.addedAt })
      .from(youtubeSongs).orderBy(desc(youtubeSongs.addedAt)).all().map(saved => audioMap.has(saved.song.videoId)
        ? { ...saved, localAudio: audioMap.get(saved.song.videoId) } : saved),
  }
}

export function readImports(): ImportJob[] {
  return getDatabase().select().from(imports).orderBy(desc(imports.createdAt)).limit(100).all()
    .map(({ stagingPath: _path, ...job }) => job)
}

export function findTrack(id: string) {
  return getDatabase().select().from(tracks).where(eq(tracks.id, id)).get()
}

export function readTracks(ids: string[]): Track[] {
  const db = getDatabase()
  return ids.flatMap(id => {
    const row = db.select().from(tracks).where(eq(tracks.id, id)).get()
    if (!row) return []
    const original = db.select().from(assets).where(eq(assets.id, row.originalId)).get()
    const mobile = row.mobileId ? db.select().from(assets).where(eq(assets.id, row.mobileId)).get() : null
    if (!original) return []
    const { filename: _originalPath, ...originalAsset } = original
    const mobileAsset = mobile ? (({ filename: _filename, ...asset }) => asset)(mobile) : null
    return [{ ...row.metadata, original: originalAsset, mobile: mobileAsset, favorite: row.favorite,
      conversion: row.conversion, conversionError: row.conversionError, conversionProgress: row.conversionProgress }]
  })
}
