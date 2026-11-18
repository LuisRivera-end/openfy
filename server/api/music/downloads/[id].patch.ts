import { z } from 'zod'
import { changeAudioDownload } from '../../../utils/audio-downloads'
import { musicResponse } from '../../../utils/music-api'

export default defineEventHandler(async event => {
  const { action } = await readValidatedBody(event, z.object({ action: z.enum(['cancel', 'retry']) }).parse)
  return musicResponse(async () => changeAudioDownload(getRouterParam(event, 'id') || '', action))
})
