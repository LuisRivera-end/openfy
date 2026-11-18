import { listeningStats, listeningPeriodSchema } from '../../utils/telemetry'
export default defineEventHandler(event => {
  const result = listeningPeriodSchema.safeParse(getQuery(event).period || '30d')
  if (!result.success) throw createError({ statusCode: 400, message: 'Período no válido.' })
  return listeningStats(result.data)
})
