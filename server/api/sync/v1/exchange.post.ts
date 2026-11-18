import { z } from 'zod'
import { youtubeSongSchema } from '../../../utils/saved-music'
import { exchangeSync, SyncError } from '../../../utils/device-sync'
import type { SyncOperation } from '../../../../shared/types/sync'
const common={ operationId:z.string().uuid(),sequence:z.number().int().positive().safe(),baseRevision:z.number().int().nonnegative().safe() }
const operation=z.discriminatedUnion('kind',[
  z.object({ ...common,kind:z.literal('favorite'),entityId:z.string().regex(/^youtube:[A-Za-z0-9_-]{11}$/),payload:z.object({ song:youtubeSongSchema,favorite:z.boolean() }) }),
  z.object({ ...common,kind:z.literal('playlist'),entityId:z.string().uuid(),payload:z.object({ name:z.string().trim().min(1).max(100),trackIds:z.array(z.string().regex(/^youtube:[A-Za-z0-9_-]{11}$/)).max(20000),songs:z.array(youtubeSongSchema).max(20000) }) }),
  z.object({ ...common,kind:z.literal('deletePlaylist'),entityId:z.string().uuid(),payload:z.object({}) }),
])
export default defineEventHandler(async event => {
  const body=await readValidatedBody(event,z.object({ deviceId:z.string().uuid(),cursor:z.number().int().nonnegative().safe().default(0),operations:z.array(operation).max(100) }).parse)
  const token=getHeader(event,'authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
  if(!token) throw createError({ statusCode:401,message:'Vincula este dispositivo desde Ajustes.' })
  try { return exchangeSync(body.deviceId,token,body.cursor,body.operations as SyncOperation[]) }
  catch(error) { if(error instanceof SyncError) throw createError({ statusCode:error.statusCode,message:error.message }); throw error }
})
