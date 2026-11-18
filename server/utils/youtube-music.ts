import { Innertube, Log, Platform, YTMusic, YTNodes } from 'youtubei.js'
import { evaluateYouTubeScript } from './youtube-evaluator'
import { MusicProviderError, logMusicFailure } from './music-errors'
import { MusicSearchCache, type SearchBatch } from './music-search'
import { normalizeCatalogSongs as normalizeSongs, isMusicVideoId as validVideoId } from './music-normalize'
export { normalizeCatalogSongs as normalizeSongs, isMusicVideoId as validVideoId } from './music-normalize'

type SearchSong = {
  id?: string; item_type?: string; title?: string; artists?: { name: string }[]
  album?: { name: string }; thumbnails?: { url: string; width?: number }[]; duration?: { seconds: number }
}

export interface AudioFormat {
  mime_type: string; has_audio: boolean; has_video: boolean; bitrate: number; content_length?: number
  decipher: (player?: Innertube['session']['player']) => Promise<string>
}
export function chooseAudioFormat(formats: AudioFormat[]): AudioFormat {
  const format = formats.filter(f => f.has_audio && !f.has_video && /^audio\/mp4\s*;\s*codecs="mp4a\.40\.2"/i.test(f.mime_type))
    .sort((a, b) => b.bitrate - a.bitrate)[0]
  if (!format) throw new MusicProviderError('UNSUPPORTED_FORMAT', 'Esta canción no tiene un formato de audio compatible.', 422)
  return format
}

export function validateAudioUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com') || url.port || url.username || url.password) {
    throw new MusicProviderError('INVALID_STREAM', 'YouTube devolvió una dirección de audio no válida.')
  }
  return url
}

Platform.shim.eval = evaluateYouTubeScript
Log.setLevel(Log.Level.ERROR)
let searchSession: Promise<Innertube> | undefined
let audioSession: Promise<Innertube> | undefined
const providerFetch: typeof fetch = (input, init) => fetch(input, { ...init,
  signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
export function youtubeSession(audio = false) {
  const existing = audio ? audioSession : searchSession
  if (existing) return existing
  const pending = Innertube.create({ lang: 'es', location: 'MX', retrieve_player: audio, fetch: providerFetch }).catch(error => {
    if (audio) audioSession = undefined; else searchSession = undefined
    throw error
  })
  if (audio) audioSession = pending; else searchSession = pending
  return pending
}

type ProviderSearch = YTMusic.Search | Awaited<ReturnType<YTMusic.Search['getContinuation']>>
function searchBatch(page: ProviderSearch): SearchBatch {
  // Avoid the SDK's English-only «Songs» heading getter for Spanish responses.
  const items = page instanceof YTMusic.Search
    ? page.contents?.filterType(YTNodes.MusicShelf).flatMap(shelf => [...shelf.contents]) || []
    : [...(page.contents?.contents || [])]
  return { songs: normalizeSongs(items as SearchSong[]), next: page.has_continuation ? async () => searchBatch(await page.getContinuation()) : null }
}
const searches = new MusicSearchCache(async query => searchBatch(await (await youtubeSession()).music.search(query, { type: 'song' })))
export async function searchYouTubeMusic(query: string, cursor?: string) {
  try {
    return await searches.search(query, cursor)
  } catch (error) {
    if (error instanceof MusicProviderError) throw error
    throw new MusicProviderError('PROVIDER_UNAVAILABLE', 'No se pudo consultar YouTube Music. Vuelve a intentarlo.')
  }
}

export interface ResolvedAudio { url: string; mime: string; bytes: number | null; expires: number }
const streams = new Map<string, ResolvedAudio>()
const resolving = new Map<string, Promise<ResolvedAudio>>()
export async function resolveYouTubeAudio(videoId: string, renew = false): Promise<ResolvedAudio> {
  if (!validVideoId(videoId)) throw new MusicProviderError('INVALID_ID', 'El identificador de canción no es válido.', 400)
  if (renew) { streams.delete(videoId); audioSession = undefined }
  const cached = streams.get(videoId)
  if (cached && cached.expires > Date.now()) return cached
  if (resolving.has(videoId)) return resolving.get(videoId)!
  const pending = (async () => {
    try {
      const client = await youtubeSession(true)
      // Keep catalog lookup and playback independent. WEB_REMIX can expose only
      // a short initial allowance; the SDK's visionOS client supplies complete AAC audio.
      const info = await client.getBasicInfo(videoId, { client: 'VISIONOS' })
      if (info.playability_status?.status !== 'OK') throw new MusicProviderError('UNAVAILABLE', 'Esta canción no está disponible para reproducir.', 422,
        { providerStatus: info.playability_status?.status || 'UNKNOWN', reason: info.playability_status?.reason || '' })
      const format = chooseAudioFormat(info.streaming_data?.adaptive_formats || [])
      const url = validateAudioUrl(await format.decipher(client.session.player))
      const expiry = Number(url.searchParams.get('expire')) * 1000
      const resolved = { url: url.href, mime: format.mime_type, bytes: format.content_length || Number(url.searchParams.get('clen')) || null,
        expires: Math.min(Number.isFinite(expiry) && expiry > Date.now() ? expiry - 60000 : Date.now() + 60000, Date.now() + 5 * 60000) }
      if (streams.size >= 100) streams.delete(streams.keys().next().value!)
      streams.set(videoId, resolved)
      return resolved
    } catch (error) {
      logMusicFailure('resolve', videoId, error)
      if (error instanceof MusicProviderError) throw error
      throw new MusicProviderError('AUDIO_UNAVAILABLE', 'No se pudo obtener el audio de YouTube. Reintenta o elige otra canción.')
    }
  })()
  resolving.set(videoId, pending)
  try { return await pending } finally { resolving.delete(videoId) }
}
