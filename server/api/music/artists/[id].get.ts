import { getYouTubeArtist } from '../../../utils/youtube-catalog'
import { musicResponse } from '../../../utils/music-api'

export default defineEventHandler(event => musicResponse(() => getYouTubeArtist(getRouterParam(event, 'id') || '')))
