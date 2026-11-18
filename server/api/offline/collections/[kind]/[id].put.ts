import { z } from 'zod'
import { setOfflineCollection } from '../../../../utils/audio-downloads'
import { musicResponse } from '../../../../utils/music-api'

export default defineEventHandler(async event => {
  const kind = z.enum(['album', 'playlist']).parse(getRouterParam(event, 'kind'))
  const id = z.string().min(1).max(300).parse(getRouterParam(event, 'id'))
  const { enabled } = await readValidatedBody(event, z.object({ enabled: z.boolean() }).parse)
  return musicResponse(() => setOfflineCollection(kind, id, enabled))
})
