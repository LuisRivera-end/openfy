import { resolveYouTubeAudio, validateAudioUrl, validVideoId } from './youtube-music'
import type { ResolvedAudio } from './youtube-music'
import { parseByteRange } from './range'
import { MusicProviderError, logMusicFailure } from './music-errors'

interface StreamOptions { method: 'GET' | 'HEAD'; range?: string; signal: AbortSignal }
interface StreamDependencies { resolve: (id: string, renew?: boolean) => Promise<ResolvedAudio>; fetch: typeof fetch }
const CHUNK_BYTES = 1024 * 1024

/** Stream bounded upstream ranges: Google can reject full-file and open-ended requests. */
export async function openYouTubeStream(id: string, options: StreamOptions,
  dependencies: StreamDependencies = { resolve: resolveYouTubeAudio, fetch }): Promise<Response> {
  if (!validVideoId(id)) throw new MusicProviderError('INVALID_ID', 'El identificador de canción no es válido.', 400)
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal.throwIfAborted()
    const audio = await dependencies.resolve(id, attempt === 1)
    options.signal.throwIfAborted()
    let url = validateAudioUrl(audio.url)
    const total = audio.bytes
    if (!total || !Number.isSafeInteger(total) || total < 1) {
      throw new MusicProviderError('UNSUPPORTED_FORMAT', 'YouTube no proporcionó un archivo de audio compatible.', 422)
    }
    const requested = parseByteRange(options.range, total)
    if (requested === 'invalid') return new Response(null, { status: 416,
      headers: { 'Content-Range': `bytes */${total}`, 'Cache-Control': 'no-store' } })
    const { start, end } = requested || { start: 0, end: total - 1 }
    const controller = new AbortController()
    const signal = AbortSignal.any([options.signal, controller.signal])
    let requestController = new AbortController()
    async function fetchPart(first: number, last: number) {
      requestController = new AbortController()
      const timeout = setTimeout(() => requestController.abort(new Error('Audio headers timed out')), 15000)
      try {
        return await dependencies.fetch(url, { method: 'GET', redirect: 'error',
          headers: { Accept: '*/*', Origin: 'https://www.youtube.com', Referer: 'https://www.youtube.com/', Range: `bytes=${first}-${last}` }, signal: AbortSignal.any([signal, requestController.signal]) })
      } finally { clearTimeout(timeout) }
    }
    const firstEnd = options.method === 'HEAD' ? start : Math.min(end, start + CHUNK_BYTES - 1)
    let upstream: Response
    try { upstream = await fetchPart(start, firstEnd) }
    catch (error) {
      if (options.signal.aborted) throw error
      if (attempt === 0) { logMusicFailure('connection-retry', id, error, { start, end: firstEnd }); continue }
      throw error
    }
    if ([401, 403, 410, 500, 502, 503, 504].includes(upstream.status) && attempt === 0) {
      logMusicFailure('initial-retry', id, new MusicProviderError('UPSTREAM_REJECTED', 'Reintentando el inicio de audio.'), { upstreamStatus: upstream.status, start, end: firstEnd })
      await upstream.body?.cancel(); continue
    }
    async function validatePart(response: Response, first: number, last: number) {
      const validStatus = response.status === 206 || (response.status === 200 && first === 0 && last === total! - 1)
      const contentRange = response.headers.get('content-range')
      const validRange = response.status !== 206 || contentRange === `bytes ${first}-${last}/${total}`
      if (!validStatus || !validRange || !response.body || !/^audio\/(mp4|x-m4a)/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel()
        throw new MusicProviderError('STREAM_REJECTED', 'YouTube no permitió reproducir esta canción. Puedes reintentar o elegir otra.', 503,
          { upstreamStatus: response.status, start: first, end: last, contentType: response.headers.get('content-type') || 'missing' })
      }
    }
    await validatePart(upstream, start, firstEnd)
    const headers = new Headers({ 'Content-Type': audio.mime, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) })
    if (requested) headers.set('Content-Range', `bytes ${start}-${end}/${total}`)
    const status = requested ? 206 : 200
    // HEAD probes a single byte because Google video hosts can reject native HEAD.
    if (options.method === 'HEAD') { await upstream.body?.cancel(); return new Response(null, { status, headers }) }
    let reader = upstream.body!.getReader()
    let partStart = start
    let partEnd = firstEnd
    let partBytes = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          for (;;) {
            signal.throwIfAborted()
            // fetch() resolves at headers. Bound each active body read as well;
            // no timer runs while downstream backpressure pauses consumption.
            const readSignal = AbortSignal.any([signal, requestController.signal])
            const timeout = setTimeout(() => requestController.abort(new Error('Audio read timed out')), 15000)
            let onAbort: (() => void) | undefined
            let result: ReadableStreamReadResult<Uint8Array>
            try {
              result = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
                if (readSignal.aborted) { reject(readSignal.reason); return }
                onAbort = () => reject(readSignal.reason)
                readSignal.addEventListener('abort', onAbort, { once: true })
              })])
            } finally { clearTimeout(timeout); if (onAbort) readSignal.removeEventListener('abort', onAbort) }
            if (!result.done) {
              partBytes += result.value.byteLength
              if (partBytes > partEnd - partStart + 1) throw new Error('Unexpected audio range size')
              output.enqueue(result.value)
              return
            }
            reader.releaseLock()
            if (partBytes !== partEnd - partStart + 1) throw new Error('Incomplete audio range')
            if (partEnd === end) { output.close(); return }
            partStart = partEnd + 1
            partEnd = Math.min(end, partStart + CHUNK_BYTES - 1)
            partBytes = 0
            let next: Response | undefined
            let connectionFailure: unknown
            try { next = await fetchPart(partStart, partEnd) } catch (error) { if (options.signal.aborted) throw error; connectionFailure = error }
            if (!next || [401, 403, 410, 500, 502, 503, 504].includes(next.status)) {
              logMusicFailure('chunk-retry', id, connectionFailure || new MusicProviderError('UPSTREAM_REJECTED', 'Reintentando un fragmento de audio.'),
                { upstreamStatus: next?.status || 0, start: partStart, end: partEnd })
              await next?.body?.cancel()
              const renewed = await dependencies.resolve(id, true)
              if (renewed.bytes !== total || renewed.mime !== audio.mime) {
                throw new MusicProviderError('STREAM_CHANGED', 'El formato de audio cambió. Toca reproducir para reintentar.')
              }
              url = validateAudioUrl(renewed.url)
              signal.throwIfAborted()
              next = await fetchPart(partStart, partEnd)
            }
            await validatePart(next, partStart, partEnd)
            reader = next.body!.getReader()
          }
        } catch (error) {
          if (!options.signal.aborted) logMusicFailure('read', id, error, { start: partStart, end: partEnd, received: partBytes })
          controller.abort(); await reader.cancel().catch(() => {}); output.error(error)
        }
      },
      async cancel() { controller.abort(); await reader.cancel().catch(() => {}) },
    })
    return new Response(body, { status, headers })
  }
  throw new MusicProviderError('STREAM_REJECTED', 'No se pudo reproducir el audio de YouTube.')
}
