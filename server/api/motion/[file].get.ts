import { createReadStream } from 'node:fs'
import { motionCache } from '../../utils/motion-art'
import { parseByteRange } from '../../utils/range'

export default defineEventHandler(async (event) => {
  const key = /^([a-f0-9]{64})\.mp4$/.exec(getRouterParam(event, 'file') || '')?.[1]
  const art = key ? await motionCache().file(key) : null
  if (!art) throw createError({ statusCode: 404, message: 'Portada animada no disponible.' })
  const range = parseByteRange(getHeader(event, 'range'), art.bytes)
  setHeaders(event, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', 'ETag': `"${art.key.slice(0, 16)}-${art.bytes}"` })
  if (range === 'invalid') {
    setResponseStatus(event, 416)
    setHeader(event, 'Content-Range', `bytes */${art.bytes}`)
    return ''
  }
  const start = range?.start ?? 0, end = range?.end ?? art.bytes - 1
  setHeader(event, 'Content-Length', end - start + 1)
  if (range) {
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${start}-${end}/${art.bytes}`)
  }
  if (event.method === 'HEAD') return sendNoContent(event, range ? 206 : 200)
  const stream = createReadStream(art.path, { start, end })
  event.node.res.on('close', () => stream.destroy())
  return sendStream(event, stream)
})
