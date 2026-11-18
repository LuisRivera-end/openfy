import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseAudioFormat, normalizeSongs, validateAudioUrl } from '../../server/utils/youtube-music'
import { evaluateYouTubeScript } from '../../server/utils/youtube-evaluator'
import { openYouTubeStream } from '../../server/utils/youtube-stream'
import type { AudioFormat, ResolvedAudio } from '../../server/utils/youtube-music'
import { MusicProviderError, logMusicFailure } from '../../server/utils/music-errors'

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const id = 'abcdefghijk'
const resolved: ResolvedAudio = { url: 'https://rr1.googlevideo.com/videoplayback?expire=9999999999', mime: 'audio/mp4; codecs="mp4a.40.2"', bytes: 100, expires: Date.now() + 60000 }
const format = (values: Partial<AudioFormat> = {}): AudioFormat => ({ mime_type: resolved.mime, has_audio: true, has_video: false, bitrate: 128000, decipher: async () => resolved.url, ...values })
const options = (values = {}) => ({ method: 'GET' as const, signal: new AbortController().signal, ...values })
const audioResponse = (status = 200, headers = {}) => new Response(new Uint8Array(100), { status, headers: { 'Content-Type': 'audio/mp4', 'Content-Length': '100', ...headers } })

describe('YouTube Music adapter', () => {
  it('times out a body stalled after headers rather than waiting forever', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let upstreamSignal: AbortSignal | undefined
    const response = await openYouTubeStream(id, options({ signal: controller.signal }), {
      resolve: async () => resolved,
      fetch: async (_url, init) => {
        upstreamSignal = init?.signal as AbortSignal
        return new Response(new ReadableStream({ start(output) {
          upstreamSignal!.addEventListener('abort', () => output.error(upstreamSignal!.reason), { once: true })
        } }), { headers: { 'Content-Type': 'audio/mp4' } })
      },
    })
    const rejected = expect(response.arrayBuffer()).rejects.toThrow('Audio read timed out')
    await vi.advanceTimersByTimeAsync(15001)
    await rejected
    expect(upstreamSignal?.aborted).toBe(true)
  })
  it('normalizes songs, missing fields and duplicate IDs, excluding videos', () => {
    expect(normalizeSongs([
      { id, title: ' Canción ', item_type: 'song', artists: [{ name: 'Artista' }, { name: 'Artista' }],
        thumbnails: [{ url: 'https://image.example/small', width: 20 }, { url: 'https://image.example/large', width: 500 }], duration: { seconds: 123 } },
      { id, title: 'Duplicada', item_type: 'song' },
      { id: '12345678901', title: 'Sin datos', item_type: 'song' },
      { id: '12345678902', title: 'Video', item_type: 'video' },
      { id: 'bad', title: 'Inválida', item_type: 'song' },
    ])).toEqual([
      { videoId: id, title: 'Canción', artists: ['Artista'], album: null, artwork: 'https://image.example/large', duration: 123 },
      { videoId: '12345678901', title: 'Sin datos', artists: [], album: null, artwork: null, duration: null },
    ])
  })
  it('chooses the best AAC audio, excluding video and unsupported codecs', () => {
    const best = format({ bitrate: 256000 })
    expect(chooseAudioFormat([format(), best, format({ has_video: true, bitrate: 300000 }), format({ mime_type: 'audio/webm; codecs="opus"', bitrate: 320000 })])).toBe(best)
    expect(() => chooseAudioFormat([format({ mime_type: 'audio/webm' })])).toThrow(MusicProviderError)
  })
  it('accepts only HTTPS Google video hosts without credentials or alternate ports', () => {
    expect(validateAudioUrl(resolved.url).hostname).toBe('rr1.googlevideo.com')
    for (const url of ['http://rr1.googlevideo.com/a', 'https://googlevideo.com.evil.example/a', 'https://localhost/a', 'https://user@rr1.googlevideo.com/a', 'https://rr1.googlevideo.com:8443/a']) {
      expect(() => validateAudioUrl(url)).toThrow()
    }
  })
})

describe('isolated decipher interpreter', () => {
  it('returns decipher values and receives only primitive inputs', async () => {
    expect(await evaluateYouTubeScript({ output: 'return {sig: sig.split("").reverse().join(""), n: n + "!"};' }, { sig: 'abc', n: '123' })).toEqual({ sig: 'cba', n: '123!' })
  })
  it('does not expose Node APIs, environment variables, or networking', async () => {
    expect(await evaluateYouTubeScript({ output: 'return {process: typeof process, require: typeof require, fetch: typeof fetch};' })).toEqual({ process: 'undefined', require: 'undefined', fetch: 'undefined' })
  })
  it('interrupts an infinite loop and remains usable after the failure', async () => {
    await expect(evaluateYouTubeScript({ output: 'while(true) {}' })).rejects.toThrow()
    expect(await evaluateYouTubeScript({ output: 'return {ok: true};' })).toEqual({ ok: true })
  })
})

describe('YouTube audio proxy', () => {
  it('logs track and upstream failure details without exposing signed URLs', () => {
    logMusicFailure('request', id, new MusicProviderError('STREAM_REJECTED', 'Failed https://rr1.googlevideo.com/audio?token=secret', 503,
      { upstreamStatus: 403, reason: 'https://rr1.googlevideo.com/?secret=abc' }))
    const record = JSON.parse(vi.mocked(console.warn).mock.calls[0]![1])
    expect(record).toMatchObject({ videoId: id, stage: 'request', code: 'STREAM_REJECTED', upstreamStatus: 403 })
    expect(JSON.stringify(record)).not.toContain('secret')
    expect(JSON.stringify(record)).not.toContain('googlevideo.com')
  })
  it('streams the body and whitelists response headers without caching', async () => {
    const upstream = audioResponse(200, { 'Set-Cookie': 'secret', 'Location': 'https://example.com' })
    const fetcher = vi.fn().mockResolvedValue(upstream)
    const response = await openYouTubeStream(id, options(), { resolve: vi.fn().mockResolvedValue(resolved), fetch: fetcher })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
    expect((await response.arrayBuffer()).byteLength).toBe(100)
    expect(fetcher.mock.calls[0]![1].redirect).toBe('error')
  })
  it('forwards byte ranges and preserves 206 headers', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array(20), { status: 206, headers: { 'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 10-29/100', 'Content-Length': '20' } }))
    const response = await openYouTubeStream(id, options({ range: 'bytes=10-29' }), { resolve: vi.fn().mockResolvedValue(resolved), fetch: fetcher })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 10-29/100')
    expect(fetcher.mock.calls[0]![1].headers.Range).toBe('bytes=10-29')
    expect((await response.arrayBuffer()).byteLength).toBe(20)
  })
  it('joins bounded upstream chunks into a complete open-ended browser range', async () => {
    const bytes = 1024 * 1024 + 7
    const fetcher = vi.fn().mockImplementation(async (_url, init) => {
      const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range)!
      const size = Number(last) - Number(first) + 1
      return new Response(new Uint8Array(size).fill(Number(first) === 0 ? 1 : 2), { status: 206,
        headers: { 'Content-Type': 'audio/mp4', 'Content-Range': `bytes ${first}-${last}/${bytes}`, 'Content-Length': String(size) } })
    })
    const response = await openYouTubeStream(id, options({ range: 'bytes=0-' }), {
      resolve: vi.fn().mockResolvedValue({ ...resolved, bytes }), fetch: fetcher,
    })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes 0-${bytes - 1}/${bytes}`)
    const body = new Uint8Array(await response.arrayBuffer())
    expect(body).toHaveLength(bytes)
    expect(body[1024 * 1024 - 1]).toBe(1)
    expect(body[1024 * 1024]).toBe(2)
    expect(fetcher.mock.calls.map(call => call[1].headers.Range)).toEqual(['bytes=0-1048575', 'bytes=1048576-1048582'])
  })
  it('rejects incomplete audio and mismatched content ranges', async () => {
    const response = await openYouTubeStream(id, options(), {
      resolve: vi.fn().mockResolvedValue(resolved),
      fetch: vi.fn().mockResolvedValue(new Response(new Uint8Array(3), { headers: { 'Content-Type': 'audio/mp4' } })),
    })
    await expect(response.arrayBuffer()).rejects.toThrow('Incomplete audio range')
    await expect(openYouTubeStream(id, options({ range: 'bytes=10-29' }), {
      resolve: vi.fn().mockResolvedValue(resolved),
      fetch: vi.fn().mockResolvedValue(new Response(new Uint8Array(20), { status: 206,
        headers: { 'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 30-49/100' } })),
    })).rejects.toMatchObject({ code: 'STREAM_REJECTED' })
  })
  it('serves HEAD with a one-byte GET probe, reporting the full length and no body', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array(1), { status: 206, headers: { 'Content-Type': 'audio/mp4', 'Content-Length': '1', 'Content-Range': 'bytes 0-0/100' } }))
    const response = await openYouTubeStream(id, options({ method: 'HEAD' }), { resolve: vi.fn().mockResolvedValue(resolved), fetch: fetcher })
    expect(fetcher.mock.calls[0]![1].method).toBe('GET')
    expect(fetcher.mock.calls[0]![1].headers.Range).toBe('bytes=0-0')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-range')).toBeNull()
    expect(response.body).toBeNull()
    expect(response.headers.get('content-length')).toBe('100')
  })
  it.each(['HTTP', 'connection'])('renews and retries a later %s failure without replaying earlier bytes', async failure => {
    const bytes = 1024 * 1024 + 3
    const resolver = vi.fn().mockResolvedValue({ ...resolved, bytes })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array(1024 * 1024).fill(1), { status: 206,
        headers: { 'Content-Type': 'audio/mp4', 'Content-Range': `bytes 0-1048575/${bytes}` } }))
      .mockImplementationOnce(() => failure === 'connection' ? Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })) : Promise.resolve(new Response(null, { status: 403 })))
      .mockResolvedValueOnce(new Response(new Uint8Array([2, 3, 4]), { status: 206,
        headers: { 'Content-Type': 'audio/mp4', 'Content-Range': `bytes 1048576-1048578/${bytes}` } }))
    const response = await openYouTubeStream(id, options(), { resolve: resolver, fetch: fetcher })
    const body = new Uint8Array(await response.arrayBuffer())
    expect(body).toHaveLength(bytes)
    expect([...body.slice(-3)]).toEqual([2, 3, 4])
    expect(resolver.mock.calls).toEqual([[id, false], [id, true]])
    expect(fetcher.mock.calls.map(call => call[1].headers.Range)).toEqual(['bytes=0-1048575', 'bytes=1048576-1048578', 'bytes=1048576-1048578'])
    expect(console.warn).toHaveBeenCalledWith('[youtube-music]', expect.stringContaining('chunk-retry'))
  })
  it('renews a rejected URL once, before exposing any bytes', async () => {
    const resolver = vi.fn().mockResolvedValue(resolved)
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(audioResponse())
    const response = await openYouTubeStream(id, options(), { resolve: resolver, fetch: fetcher })
    expect(response.ok).toBe(true)
    expect(resolver.mock.calls).toEqual([[id, false], [id, true]])
  })
  it('renews a cached URL after a connection failure instead of repeating its 503', async () => {
    const resolver = vi.fn().mockResolvedValue(resolved)
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })).mockResolvedValueOnce(audioResponse())
    const response = await openYouTubeStream(id, options(), { resolve: resolver, fetch: fetcher })
    expect((await response.arrayBuffer()).byteLength).toBe(100)
    expect(resolver.mock.calls).toEqual([[id, false], [id, true]])
    expect(console.warn).toHaveBeenCalledWith('[youtube-music]', expect.stringContaining('ECONNRESET'))
  })
  it('stops after two rejected URLs and reports a recoverable provider error', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(null, { status: 403 }))
    await expect(openYouTubeStream(id, options(), { resolve: vi.fn().mockResolvedValue(resolved), fetch: fetcher })).rejects.toMatchObject({ code: 'STREAM_REJECTED' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('rejects invalid ranges before fetching the audio', async () => {
    const fetcher = vi.fn()
    for (const range of ['bytes=100-', 'bytes=0-1,4-5', 'invalid']) {
      const response = await openYouTubeStream(id, options({ range }), { resolve: vi.fn().mockResolvedValue(resolved), fetch: fetcher })
      expect(response.status).toBe(416)
      expect(response.headers.get('content-range')).toBe('bytes */100')
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('propagates client cancellation to the upstream request', async () => {
    const controller = new AbortController()
    let signal: AbortSignal | undefined
    const fetcher = vi.fn().mockImplementation(async (_url, init) => { signal = init.signal; return audioResponse() })
    const response = await openYouTubeStream(id, options({ signal: controller.signal }), { resolve: vi.fn().mockResolvedValue(resolved), fetch: fetcher })
    controller.abort()
    expect(signal?.aborted).toBe(true)
    await response.body?.cancel()
  })
  it('does not resolve arbitrary URLs or already cancelled requests', async () => {
    const resolver = vi.fn()
    await expect(openYouTubeStream('https://example.com', options(), { resolve: resolver, fetch: vi.fn() })).rejects.toMatchObject({ code: 'INVALID_ID' })
    const controller = new AbortController(); controller.abort()
    await expect(openYouTubeStream(id, options({ signal: controller.signal }), { resolve: resolver, fetch: vi.fn() })).rejects.toThrow()
    expect(resolver).not.toHaveBeenCalled()
  })
})
