import { savedSongSchema, saveYouTubeSong } from '../../utils/saved-music'
import { wakeWorkers } from '../../utils/workers'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, savedSongSchema.parse)
  const saved = saveYouTubeSong(body)
  // A newly saved song may still need its album or genre.
  wakeWorkers()
  return saved
})
