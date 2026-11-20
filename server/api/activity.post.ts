import { z } from 'zod'
import { setPlaybackActivity } from '../utils/workers'
import { reportClient, updateChallenge, isMaintenance } from '../utils/update-maintenance'
export default defineEventHandler(async event => {
  const body = await readValidatedBody(event, z.object({ clientId: z.string().uuid(), playing: z.boolean(), ready: z.boolean().optional(), closed: z.boolean().optional(), ack: z.string().uuid().optional() }).parse)
  reportClient(body.clientId, body.playing, body.ready, body.closed, body.ack)
  setPlaybackActivity(body.clientId, !body.closed && body.playing)
  return { ok: true, challenge: updateChallenge(), maintenance: isMaintenance() }
})
