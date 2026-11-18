import { openYouTubeStream } from '../../../../utils/youtube-stream'
import { MusicProviderError, logMusicFailure } from '../../../../utils/music-errors'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../../../../database'
import { youtubeAudio } from '../../../../database/schema'

export default defineEventHandler(async (event) => {
  if (!['GET', 'HEAD'].includes(event.method)) throw createError({ statusCode: 405 })
  // Even an old queue's streaming URL stays local after downloading. Keep the
  // association authoritative if its file is missing: fail locally, never stream.
  const downloaded = getDatabase().select({ assetId: youtubeAudio.assetId }).from(youtubeAudio)
    .where(eq(youtubeAudio.videoId, getRouterParam(event, 'videoId') || '')).get()
  if (downloaded) return sendRedirect(event, `/api/assets/${encodeURIComponent(downloaded.assetId)}`, 307)
  const controller = new AbortController()
  const close = () => controller.abort()
  event.node.res.on('close', close)
  try {
    const response = await openYouTubeStream(getRouterParam(event, 'videoId') || '', {
      method: event.method as 'GET' | 'HEAD', range: getHeader(event, 'range'), signal: controller.signal,
    })
    setResponseStatus(event, response.status)
    for (const [name, value] of response.headers) setHeader(event, name, value)
    if (!response.body) { event.node.res.end(); return }
    // Node's pipeline honors socket backpressure and tears down both sides on disconnect.
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), event.node.res, { signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) return
    logMusicFailure('request', getRouterParam(event, 'videoId') || '', error, { method: event.method, range: (getHeader(event, 'range') || '').slice(0, 80) })
    const failure = error instanceof MusicProviderError ? error : new MusicProviderError('STREAM_UNAVAILABLE', 'No se pudo conectar con el audio de YouTube. Vuelve a intentarlo.')
    throw createError({ statusCode: failure.statusCode, message: failure.message, data: { code: failure.code } })
  } finally { event.node.res.off('close', close) }
})
