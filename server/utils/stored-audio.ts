import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { dataPaths, getDatabase } from '../database'
import { assets, youtubeAudio } from '../database/schema'
import type { StoredYouTubeAudio } from '../../shared/types/music'

/** One database query and bounded asynchronous disk checks for HTTP snapshots. */
export async function readStoredAudioAsync() {
  const rows = getDatabase().select({ audio: youtubeAudio, asset: assets }).from(youtubeAudio)
    .innerJoin(assets, eq(youtubeAudio.assetId, assets.id)).all()
  const root = dataPaths().originals, available = new Map<string, StoredYouTubeAudio>()
  for (let offset = 0; offset < rows.length; offset += 16) {
    await Promise.all(rows.slice(offset, offset + 16).map(async ({ audio, asset }) => {
      try {
        if ((await stat(join(root, asset.filename))).size !== asset.bytes) return
        const { filename: _filename, ...descriptor } = asset
        available.set(audio.videoId, { asset: descriptor, duration: audio.duration, artwork: audio.artwork,
          palette: audio.palette, downloadedAt: audio.downloadedAt })
      } catch { /* A removed or incomplete file is never advertised as available. */ }
    }))
  }
  return available
}
