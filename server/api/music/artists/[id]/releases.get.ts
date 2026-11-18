import { getYouTubeArtistReleases } from '../../../../utils/youtube-catalog'
import { musicCursor, musicResponse } from '../../../../utils/music-api'

export default defineEventHandler(event => {
  const { kind } = getQuery(event)
  if (kind !== 'albums' && kind !== 'singles') throw createError({ statusCode: 400, message: 'El tipo de lanzamiento no es válido.' })
  const cursor = musicCursor(event)
  return musicResponse(() => getYouTubeArtistReleases(getRouterParam(event, 'id') || '', kind, cursor))
})
