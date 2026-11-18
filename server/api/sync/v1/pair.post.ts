import { z } from 'zod'
import { pairDevice, SyncError } from '../../../utils/device-sync'
export default defineEventHandler(async event => {
  const body = await readValidatedBody(event,z.object({ code:z.string().max(40), deviceId:z.string().uuid(), name:z.string().trim().min(1).max(100) }).parse)
  try { return pairDevice(body.code,body.deviceId,body.name) }
  catch(error) { if(error instanceof SyncError) throw createError({ statusCode:error.statusCode,message:error.message }); throw error }
})
