import { getYouTubeAlbum } from '../../../utils/youtube-catalog'
import { musicResponse } from '../../../utils/music-api'

export default defineEventHandler(event => musicResponse(() => getYouTubeAlbum(getRouterParam(event, 'id') || '')))
