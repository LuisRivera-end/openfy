import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { artworkCache } from '../../utils/artwork-cache'
import { dataPaths } from '../../database'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') || ''
  if (!/^[a-f0-9]{64}\.webp$/.test(id)) throw createError({ statusCode: 404 })
  const size = getQuery(event).size
  if (size) {
    const variant = await artworkCache().prepare('/api/artwork/' + id, size)
    setHeaders(event, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable' })
    return sendStream(event, createReadStream(variant.path))
  }
  const path = join(dataPaths().artwork, id)
  await access(path).catch(() => { throw createError({ statusCode: 404 }) })
  setHeaders(event, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable' })
  return sendStream(event, createReadStream(path))
})
