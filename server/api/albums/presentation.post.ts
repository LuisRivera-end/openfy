import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../../database'
import { tracks } from '../../database/schema'
import { motionCache, songMotionSignature, trackMotionSignature } from '../../utils/motion-art'
import { validAlbumId } from '../../utils/music-normalize'
import { getYouTubeAlbum } from '../../utils/youtube-catalog'
import type { AlbumPresentation } from '../../../shared/types/music'

const shortText = z.string().trim().min(1).max(500)
const schema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('local'), trackId: z.uuid(), motion: z.boolean().optional() }),
  z.object({ source: z.literal('youtube'), albumId: z.string().optional(), artists: z.array(shortText).min(1).max(20), album: shortText, motion: z.boolean().optional() }),
])

export default defineEventHandler(async (event): Promise<AlbumPresentation> => {
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Los datos de la solicitud no son válidos.' })
  const entry = parsed.data
  const track = entry.source === 'local' ? getDatabase().select({ metadata: tracks.metadata }).from(tracks).where(eq(tracks.id, entry.trackId)).get() : undefined
  const signature = entry.source === 'youtube' ? songMotionSignature(entry) : track ? trackMotionSignature(track.metadata) : null
  const { presentation, retryAfterMs }: { presentation: AlbumPresentation; retryAfterMs: number } = signature
    ? await motionCache().albumPresentation(signature, { motion: entry.motion === true })
    : { presentation: { motion: { status: 'none' } }, retryAfterMs: 0 }

  let delay = retryAfterMs
  if (!presentation.description && entry.source === 'youtube' && entry.albumId?.startsWith('MPRE') && entry.albumId.length > 4 && validAlbumId(entry.albumId)) {
    try {
      const text = (await getYouTubeAlbum(entry.albumId)).description
      if (text) presentation.description = { text, source: 'youtube' }
    } catch {
      delay = Math.max(delay, 15 * 60_000)
    }
  }
  if (delay) setHeader(event, 'Retry-After', Math.ceil(delay / 1000))
  return presentation
})
