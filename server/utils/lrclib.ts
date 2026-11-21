import { z } from 'zod'
import { normalizeLyricsName, parseLrc } from '../../shared/utils/lyrics'
import type { LyricsContent, LyricsSignature } from '../../shared/types/lyrics'

export class LyricsProviderError extends Error {
  constructor(message = 'No se pudieron consultar las letras. Vuelve a intentarlo.', public retryAfter = 0) {
    super(message)
    this.name = 'LyricsProviderError'
  }
}

const recordSchema = z.object({
  id: z.number(), trackName: z.string(), artistName: z.string(), albumName: z.string(), duration: z.number().finite(),
  instrumental: z.boolean(), plainLyrics: z.string().max(200000).nullable(), syncedLyrics: z.string().max(200000).nullable(),
})
export type LrcRecord = z.infer<typeof recordSchema>
export interface ProviderLyrics extends LyricsContent {
  instrumental: boolean
  source: 'lrclib' | 'youtube'
  attribution: string
  sourceUrl: string
}

export function matchesLyrics(record: LrcRecord, signature: LyricsSignature) {
  const artist = normalizeLyricsName(record.artistName)
  const artistParts = record.artistName.split(/[,;&]|\s+(?:feat\.?|ft\.?|featuring)\s+/i).map(normalizeLyricsName)
  return normalizeLyricsName(record.trackName) === normalizeLyricsName(signature.title)
    && signature.artists.some(name => normalizeLyricsName(name) === artist || artistParts.includes(normalizeLyricsName(name)))
    && (signature.duration === null || Math.abs(record.duration - signature.duration) <= 2)
}

/** One queue per process; cooldowns reject locally instead of flooding the provider. */
export class LrcClient {
  private tail: Promise<unknown> = Promise.resolve()
  private lastRequest = 0
  private blockedUntil = 0
  constructor(private fetcher: typeof fetch = fetch, private now = Date.now,
    private delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}

  async get(signature: LyricsSignature): Promise<ProviderLyrics | null> {
    if (!signature.title || !signature.artists.length) return null
    const pending = this.tail.then<ProviderLyrics | null>(async () => {
      const remaining = () => Math.ceil((this.blockedUntil - this.now()) / 1000)
      if (remaining() > 0) throw new LyricsProviderError('El servicio de letras está ocupado. Reintenta en unos momentos.', remaining())
      await this.delay(Math.max(0, this.lastRequest + 300 - this.now()))
      this.lastRequest = this.now()
      const url = new URL('https://lrclib.net/api/get')
      url.searchParams.set('track_name', signature.title)
      url.searchParams.set('artist_name', signature.artists[0]!)
      if (signature.album) url.searchParams.set('album_name', signature.album)
      if (signature.duration !== null && signature.duration >= 1 && signature.duration <= 3600) url.searchParams.set('duration', String(Math.round(signature.duration)))
      let response: Response
      try {
        response = await this.fetcher(url, { headers: { 'User-Agent': 'Openfy v0.1.0 (https://github.com/LuisRivera-end/openfy)', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
      } catch { throw new LyricsProviderError() }
      if (response.status === 404) return null
      if (response.status === 429 || response.status === 503) {
        const header = response.headers.get('retry-after')
        const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - this.now()) / 1000) : 0
        const wait = Math.max(1, Number.isFinite(seconds) && seconds > 0 ? seconds : 30)
        this.blockedUntil = this.now() + Math.ceil(wait * (1 + Math.random() * .3)) * 1000
        throw new LyricsProviderError('El servicio de letras está ocupado. Reintenta en unos momentos.', remaining())
      }
      if (!response.ok) throw new LyricsProviderError()
      const parsed = recordSchema.safeParse(await response.json().catch(() => null))
      if (!parsed.success) throw new LyricsProviderError()
      const record = parsed.data
      if (!matchesLyrics(record, signature)) return null
      const lrc = parseLrc(record.syncedLyrics || '')
      const lines = lrc.lines.some(line => line.text) ? lrc.lines : []
      const plainText = record.plainLyrics?.trim() || lrc.plainText
      if (!record.instrumental && !plainText && !lines.length) return null
      return { lines: record.instrumental ? [] : lines, plainText: record.instrumental ? '' : plainText,
        instrumental: record.instrumental, source: 'lrclib', attribution: 'Letras de LRCLIB', sourceUrl: `https://lrclib.net/api/get/${record.id}` }
    })
    this.tail = pending.catch(() => {})
    return pending
  }
}

export const lrcClient = new LrcClient()
