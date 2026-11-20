import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../../database'
import { tracks } from '../../database/schema'
import { motionCache, songMotionSignature, trackMotionSignature } from '../../utils/motion-art'
import { MotionProviderError } from '../../utils/apple-motion'
import type { MotionArtResult } from '../../../shared/types/music'

const shortText = z.string().trim().min(1).max(500)
const schema = z.object({
  entry: z.discriminatedUnion('source', [
    z.object({ source: z.literal('local'), trackId: z.uuid() }),
    z.object({ source: z.literal('youtube'), song: z.object({ artists: z.array(shortText).max(20), album: shortText.nullable() }) }),
    z.object({ source: z.literal('artist'), artistId: shortText.optional(), name: shortText, albums: z.array(shortText).max(40) }),
  ]),
})

/** Editorial motion for an album cover or artist header, fetched and stored on first use. */
export default defineEventHandler(async (event): Promise<MotionArtResult> => {
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Los datos de la solicitud no son válidos.' })
  const entry = parsed.data.entry
  const track = entry.source === 'local' ? getDatabase().select({ metadata: tracks.metadata }).from(tracks).where(eq(tracks.id, entry.trackId)).get() : undefined
  const signature = entry.source === 'artist' ? { kind: 'artist' as const, artistId: entry.artistId, name: entry.name, albums: entry.albums }
    : entry.source === 'youtube' ? songMotionSignature(entry.song) : track ? trackMotionSignature(track.metadata) : null
  if (!signature) return { status: 'none' }
  try {
    const result = await motionCache().lookup(signature)
    if (result.status !== 'ready') return result
    const { art } = result
    return { status: 'ready', url: `/api/motion/${art.key}.mp4`, width: art.width, height: art.height }
  } catch (error) {
    // Keep the static artwork while the provider is unavailable.
    const retryAfterMs = error instanceof MotionProviderError ? error.retryAfterMs : 15 * 60_000
    setHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000))
    throw createError({ statusCode: 503, message: 'La portada animada no está disponible ahora.', data: { code: 'MOTION_UNAVAILABLE', retryAfterMs } })
  }
})
