import { eq } from 'drizzle-orm'
import { getDatabase } from '../../database'
import { playlists } from '../../database/schema'
import { capturePlaylist } from '../../utils/device-sync'

export default defineEventHandler(event => {
  const id = getRouterParam(event, 'id') || ''
  getDatabase().delete(playlists).where(eq(playlists.id, id)).run()
  capturePlaylist(id)
  return { ok: true }
})
