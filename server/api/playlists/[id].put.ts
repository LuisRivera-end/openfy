import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDatabase } from '../../database'
import { playlists } from '../../database/schema'
import { collectionIdSchema, knownCollectionIds } from '../../utils/saved-music'
import { capturePlaylist } from '../../utils/device-sync'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''
  const body = await readValidatedBody(event, z.object({
    name: z.string().trim().min(1).max(100),
    trackIds: z.array(collectionIdSchema).max(20000), revision: z.number().int().positive(),
  }).parse)
  const db = getDatabase()
  const known = knownCollectionIds()
  if (body.trackIds.some(id => !known.has(id))) throw createError({ statusCode: 400, message: 'La playlist contiene canciones que ya no están en la biblioteca.' })
  const changed = db.update(playlists).set({ ...body, trackIds: [...new Set(body.trackIds)], revision: body.revision + 1, updatedAt: Date.now() })
    .where(and(eq(playlists.id, id), eq(playlists.revision, body.revision))).returning().get()
  if (!changed) throw createError({ statusCode: 409, message: 'La playlist cambió en otro dispositivo. Actualiza e inténtalo de nuevo.' })
  capturePlaylist(id)
  return changed
})
