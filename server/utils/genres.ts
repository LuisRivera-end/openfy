import { eq } from 'drizzle-orm'
import { parseFile } from 'music-metadata'
import { join } from 'node:path'
import { getDatabase, dataPaths } from '../database'
import { assets, tracks } from '../database/schema'
import { notifyDesktop } from './desktop-events'

export async function scanTrackGenres(id: string) {
  const db = getDatabase()
  const track = db.select().from(tracks).where(eq(tracks.id, id)).get()
  if (!track || track.genresScanned) return
  const asset = db.select().from(assets).where(eq(assets.id, track.originalId)).get()
  let genres: string[] = []
  if (asset) {
    try { genres = [...new Set((await parseFile(join(dataPaths().originals, asset.filename), { skipCovers: true })).common.genre?.map(value => value.trim()).filter(Boolean) || [])] }
    catch { /* A missing original must not prevent opening the library. */ }
  }
  // Re-read after async IO to retain concurrent metadata edits.
  const current = db.select().from(tracks).where(eq(tracks.id, id)).get()
  if (current) db.update(tracks).set({ genresScanned: true, metadata: { ...current.metadata, genres } }).where(eq(tracks.id, id)).run()
  notifyDesktop('libraryChanged', { trackIds: [id] })
}
