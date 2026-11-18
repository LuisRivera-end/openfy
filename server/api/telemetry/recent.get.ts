import { z } from 'zod'
import { recentlyPlayed } from '../../utils/telemetry'

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(24).default(12) })
export default defineEventHandler(event => {
  const query = querySchema.safeParse(getQuery(event))
  if (!query.success) throw createError({ statusCode: 400, message: 'Límite de canciones recientes no válido.' })
  return recentlyPlayed(query.data.limit)
})
