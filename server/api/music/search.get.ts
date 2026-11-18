import { searchYouTubeMusic } from '../../utils/youtube-music'
import { MusicProviderError } from '../../utils/music-errors'
import { searchYouTubeAlbums, searchYouTubeArtists } from '../../utils/youtube-catalog'

export default defineEventHandler(async (event) => {
  const { q: value, cursor, type } = getQuery(event)
  if (type !== undefined && type !== 'song' && type !== 'artist' && type !== 'album') {
    throw createError({ statusCode: 400, message: 'El tipo de búsqueda no es válido.' })
  }
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 200) {
    throw createError({ statusCode: 400, message: 'Escribe entre 2 y 200 caracteres para buscar.' })
  }
  if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 64)) {
    throw createError({ statusCode: 400, message: 'La continuación de búsqueda no es válida.' })
  }
  try { return await (type === 'artist' ? searchYouTubeArtists : type === 'album' ? searchYouTubeAlbums : searchYouTubeMusic)(value.trim(), cursor as string | undefined) }
  catch (error) {
    const failure = error instanceof MusicProviderError ? error : new MusicProviderError('PROVIDER_UNAVAILABLE', 'YouTube Music no está disponible. Reintenta en un momento.')
    throw createError({ statusCode: failure.statusCode, message: failure.message, data: { code: failure.code } })
  }
})
