import { removeYouTubeAudio } from '../../../../utils/audio-downloads'
import { musicResponse } from '../../../../utils/music-api'
import { validVideoId } from '../../../../utils/youtube-music'

export default defineEventHandler(event => musicResponse(async () => {
  const id = getRouterParam(event, 'videoId') || ''
  if (!validVideoId(id)) throw createError({ statusCode: 400, message: 'Canción no válida.' })
  return removeYouTubeAudio(id)
}))
