import { z } from 'zod'
import { mostPlayed, listeningPeriodSchema } from '../../utils/telemetry'
const querySchema = z.object({ period: listeningPeriodSchema.default('30d'), offset: z.coerce.number().int().min(0).max(1000000).default(0), limit: z.coerce.number().int().min(1).max(100).default(50), sort: z.enum(['plays', 'minutes']).default('plays'), query: z.string().max(200).default(''), artist: z.string().max(1000).default(''), album: z.string().max(1000).default(''), genre: z.string().max(200).default(''), favorite: z.enum(['true', 'false']).default('false'), source: z.enum(['all', 'local', 'youtube']).default('all') })
export default defineEventHandler(event => {
  const result = querySchema.safeParse(getQuery(event))
  if (!result.success) throw createError({ statusCode: 400, message: 'Filtros del ranking no válidos.' })
  const query = result.data
  return mostPlayed(query.period, query.offset, query.limit, query.sort, { ...query, favorite: query.favorite === 'true' })
})
