import { z } from 'zod'
import { youtubeSongSchema } from '../../../utils/saved-music'
import { queueAudioDownloads } from '../../../utils/audio-downloads'
import { musicResponse } from '../../../utils/music-api'

export default defineEventHandler(async event => {
  const body = await readValidatedBody(event, z.object({ songs: z.array(youtubeSongSchema).min(1).max(100),
    intent: z.enum(['manual', 'automatic']).default('manual') }).parse)
  const jobs = await musicResponse(async () => queueAudioDownloads(body.songs, body.intent))
  setResponseStatus(event, 202)
  return jobs
})
