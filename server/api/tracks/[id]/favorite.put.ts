import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDatabase } from '../../../database'
import { tracks } from '../../../database/schema'
import { findTrack } from '../../../utils/library'
import { setYouTubeFavorite } from '../../../utils/saved-music'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''
  const body = await readValidatedBody(event, z.object({ favorite: z.boolean() }).parse)
  if (/^youtube:[\w-]{11}$/.test(id)) {
    if (!setYouTubeFavorite(id.slice(8), body.favorite)) throw createError({ statusCode: 404 })
    return body
  }
  if (!findTrack(id)) throw createError({ statusCode: 404 })
  getDatabase().update(tracks).set(body).where(eq(tracks.id, id)).run()
  return body
})
