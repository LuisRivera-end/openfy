import { readFile } from 'node:fs/promises'
import { prepareArtwork } from '../../utils/artwork-cache'

export default defineEventHandler(async event => {
  const { url, size } = getQuery(event)
  try {
    const art = await prepareArtwork(url, size || 128)
    const bytes = await readFile(art.path)
    setHeader(event, 'Content-Type', 'image/png')
    setHeader(event, 'Cache-Control', 'public, max-age=86400, stale-if-error=604800')
    setHeader(event, 'ETag', `"${art.key}-${size || 128}-${art.width}x${art.height}"`)
    return bytes
  } catch {
    setHeader(event, 'Cache-Control', 'no-store')
    throw createError({ statusCode: 502, statusMessage: 'Portada temporalmente no disponible' })
  }
})
