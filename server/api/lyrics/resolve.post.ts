import { z } from 'zod'
import { resolveLyrics, LyricsTrackNotFound } from '../../utils/lyrics'
import { LyricsProviderError } from '../../utils/lrclib'

const shortText = z.string().trim().min(1).max(500)
const duration = z.number().finite().min(0).max(86400)
const schema = z.object({
  entry: z.discriminatedUnion('source', [
    z.object({ source: z.literal('local'), trackId: z.uuid() }),
    z.object({ source: z.literal('youtube'), song: z.object({
      videoId: z.string().regex(/^[\w-]{11}$/), title: shortText,
      artists: z.array(shortText).max(20), album: shortText.nullable(), duration: duration.nullable(),
      artwork: z.string().max(2000).nullable(),
    }) }),
  ]), duration: duration.optional(), refresh: z.boolean().optional(), localOnly: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Los datos de la canción no son válidos.' })
  try { return await resolveLyrics(parsed.data) }
  catch (error) {
    if (error instanceof LyricsTrackNotFound) throw createError({ statusCode: 404, message: 'La canción ya no está en tu biblioteca.' })
    const failure = error instanceof LyricsProviderError ? error : new LyricsProviderError()
    if (failure.retryAfter) setHeader(event, 'Retry-After', failure.retryAfter)
    throw createError({ statusCode: 503, message: failure.message, data: { code: 'LYRICS_UNAVAILABLE', retryAfter: failure.retryAfter } })
  }
})
