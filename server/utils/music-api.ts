import type { H3Event } from 'h3'
import { MusicProviderError } from './music-errors'

export function musicCursor(event: H3Event) {
  const { cursor } = getQuery(event)
  if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 64)) {
    throw createError({ statusCode: 400, message: 'La continuación no es válida.' })
  }
  return cursor as string | undefined
}
export async function musicResponse<T>(load: () => Promise<T>): Promise<T> {
  try { return await load() }
  catch (error) {
    const failure = error instanceof MusicProviderError ? error : new MusicProviderError('PROVIDER_UNAVAILABLE', 'No se pudo consultar YouTube Music. Vuelve a intentarlo.')
    throw createError({ statusCode: failure.statusCode, message: failure.message, data: { code: failure.code } })
  }
}
