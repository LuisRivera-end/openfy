import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getDatabase } from '../../database'
import { playlists } from '../../database/schema'
import { capturePlaylist } from '../../utils/device-sync'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({ name: z.string().trim().min(1).max(100) }).parse)
  const playlist = { id: randomUUID(), name: body.name, trackIds: [], revision: 1, updatedAt: Date.now() }
  getDatabase().insert(playlists).values(playlist).run()
  capturePlaylist(playlist.id)
  setResponseStatus(event, 201)
  return playlist
})
