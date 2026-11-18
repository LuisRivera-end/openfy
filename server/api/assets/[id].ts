import { eq } from 'drizzle-orm'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getDatabase, dataPaths } from '../../database'
import { assets } from '../../database/schema'
import { parseByteRange } from '../../utils/range'

export default defineEventHandler(async (event) => {
  if (!['GET', 'HEAD'].includes(event.method)) throw createError({ statusCode: 405 })
  const asset = getDatabase().select().from(assets).where(eq(assets.id, getRouterParam(event, 'id') || '')).get()
  if (!asset) throw createError({ statusCode: 404, message: 'Archivo no disponible.' })
  const folder = asset.variant === 'original' ? dataPaths().originals : dataPaths().mobile
  // Filenames are generated internally from UUIDs and validated extensions.
  const path = join(folder, asset.filename)
  const info = await stat(path).catch(() => null)
  if (!info) throw createError({ statusCode: 404, message: 'No se encuentra el archivo en el PC.' })
  const range = parseByteRange(getHeader(event, 'range'), info.size)
  setHeaders(event, {
    'Content-Type': asset.mime, 'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'ETag': `"${asset.hash}"`,
    'X-Content-SHA256': asset.hash,
  })
  if (range === 'invalid') {
    setResponseStatus(event, 416)
    setHeader(event, 'Content-Range', `bytes */${info.size}`)
    return ''
  }
  const start = range?.start ?? 0
  const end = range?.end ?? info.size - 1
  setHeader(event, 'Content-Length', end - start + 1)
  if (range) {
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${start}-${end}/${info.size}`)
  }
  if (event.method === 'HEAD') return sendNoContent(event, range ? 206 : 200)
  const stream = createReadStream(path, { start, end })
  event.node.res.on('close', () => stream.destroy())
  return sendStream(event, stream)
})
