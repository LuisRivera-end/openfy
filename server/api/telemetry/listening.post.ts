import { ingestListening, listeningBatchSchema } from '../../utils/telemetry'
import { notifyDesktop } from '../../utils/desktop-events'
export default defineEventHandler(async event => {
  const body = await readValidatedBody(event, listeningBatchSchema.parse)
  try {
    const result = ingestListening(body.sessions)
    notifyDesktop('telemetryChanged')
    return result
  } catch { throw createError({ statusCode: 409, message: 'La versión o identidad de una sesión de escucha no es válida.' }) }
})
