import { getYouTubeArtistSongs } from '../../../../utils/youtube-catalog'
import { musicCursor, musicResponse } from '../../../../utils/music-api'

export default defineEventHandler(event => {
  const cursor = musicCursor(event)
  return musicResponse(() => getYouTubeArtistSongs(getRouterParam(event, 'id') || '', cursor))
})
