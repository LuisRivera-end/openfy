import { createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { metadataKey, sameArtist } from './youtube-metadata'
import { diagnosticError, sessionDiagnostic } from './session-diagnostics'

/**
 * Editorial album and artist videos as the Apple Music web player receives
 * them. There is no public contract for the catalog endpoint or its token: any
 * unexpected answer is a provider failure, and callers keep the static cover.
 * Only artist and album names leave the server.
 */

export class MotionProviderError extends Error {
  constructor(message: string, public retryAfterMs = 15 * 60_000) { super(message); this.name = 'MotionProviderError' }
}

export interface MotionSignature { artists: string[]; album: string }
export interface ArtistMotionSignature { kind: 'artist'; artistId?: string; name: string; albums: string[] }
export interface MotionSource { albumId: number; master: string }
export type MotionLookup = { status: 'ready'; source: MotionSource }
  | { status: 'none'; albumIds: number[] } | { status: 'unmatched' }
type ArtistMotionLookup = { status: 'ready'; source: { artistId: number; master: string; albumKeys: string[] } }
  | { status: 'none'; artistIds: number[] } | { status: 'unmatched' }
export type MotionKind = 'album' | 'artist'
export interface MotionVariant { url: string; width: number; height: number; bandwidth: number }
export interface MotionPart { url: string; start?: number; length?: number }
export interface MotionProvider {
  find(signature: MotionSignature): Promise<MotionLookup>
  findArtist?(signature: ArtistMotionSignature): Promise<ArtistMotionLookup>
  download(master: string, destination: string, signal?: AbortSignal, kind?: MotionKind): Promise<{ width: number; height: number }>
}

/** Real catalog names can consist only of symbols, such as the album "?" and the artist "¥$". */
export function motionMetadataKey(value: string) {
  const key = metadataKey(value)
  if (key) return key
  const symbols = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
  return symbols ? `symbols:${symbols}` : ''
}

export const artistAlbumKey = (value: string) => motionMetadataKey(value.trim().replace(/\s+-\s+(?:single|ep)$/i, ''))

type Fetcher = typeof fetch
const AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const PLAYER = 'https://music.apple.com'
const MAX_HEIGHT = 1080
const MAX_ARTIST_WIDTH = 1920
const MAX_BANDWIDTH = 6_000_000
export const MAX_MOTION_BYTES = 64 * 1024 ** 2
const MAX_CANDIDATES = 3

/** Media is fetched only over HTTPS from Apple hosts, without credentials or ports. */
export function motionUrl(value: string, base?: string): string {
  let url: URL
  try { url = new URL(value, base) } catch { throw new MotionProviderError('Motion URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/(^|\.)apple\.com$/.test(url.hostname)) throw new MotionProviderError('Motion host')
  return url.href
}

function attributes(line: string) {
  const result: Record<string, string> = {}
  for (const match of line.slice(line.indexOf(':') + 1).matchAll(/([A-Z0-9_-]+)=("[^"]*"|[^,]*)/g)) result[match[1]!] = match[2]!.replace(/^"|"$/g, '')
  return result
}

/** The largest H.264 rendition within the album or artist size limit. */
export function motionVariant(master: string, base: string, kind: MotionKind = 'album'): MotionVariant | null {
  const lines = master.split(/\r?\n/), variants: MotionVariant[] = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index]!.startsWith('#EXT-X-STREAM-INF:')) continue
    const values = attributes(lines[index]!), target = lines.slice(index + 1).find(line => line.trim() && !line.startsWith('#'))
    const size = /^(\d+)x(\d+)$/.exec(values.RESOLUTION || ''), bandwidth = Number(values.BANDWIDTH)
    if (!target || !size || !/(^|,)\s*avc1\./.test(values.CODECS || '') || !Number.isFinite(bandwidth)) continue
    const width = Number(size[1]), height = Number(size[2])
    if (kind === 'artist' ? width > MAX_ARTIST_WIDTH : height > MAX_HEIGHT || width > MAX_HEIGHT * 2) continue
    variants.push({ url: motionUrl(target.trim(), base), width, height, bandwidth })
  }
  if (!variants.length) return null
  const dimension = kind === 'artist' ? 'width' : 'height'
  const size = Math.max(...variants.map(variant => variant[dimension]))
  const largest = variants.filter(variant => variant[dimension] === size).sort((a, b) => a.bandwidth - b.bandwidth)
  return largest.filter(variant => variant.bandwidth <= MAX_BANDWIDTH).pop() || largest[0]!
}

/** Initialization section first, then every segment; adjacent ranges of one file are merged. */
export function motionParts(playlist: string, base: string): MotionPart[] {
  const parts: MotionPart[] = [], ends = new Map<string, number>()
  let range: string | undefined
  const add = (target: string, spec?: string) => {
    const url = motionUrl(target, base)
    if (!spec) { parts.push({ url }); return }
    const match = /^(\d+)(?:@(\d+))?$/.exec(spec)
    if (!match) throw new MotionProviderError('Motion byte range')
    const length = Number(match[1]), start = match[2] === undefined ? ends.get(url) : Number(match[2])
    if (start === undefined || !Number.isSafeInteger(start) || !Number.isSafeInteger(length) || length < 1) throw new MotionProviderError('Motion byte range')
    ends.set(url, start + length)
    const previous = parts[parts.length - 1]
    if (previous && previous.url === url && previous.start !== undefined && previous.start + previous.length! === start) previous.length! += length
    else parts.push({ url, start, length })
  }
  for (const raw of playlist.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#EXT-X-KEY:') && attributes(line).METHOD !== 'NONE') throw new MotionProviderError('Motion encrypted')
    else if (line.startsWith('#EXT-X-MAP:')) { const values = attributes(line); if (!values.URI) throw new MotionProviderError('Motion map'); add(values.URI, values.BYTERANGE) }
    else if (line.startsWith('#EXT-X-BYTERANGE:')) range = line.slice(line.indexOf(':') + 1).trim()
    else if (line && !line.startsWith('#')) { add(line, range); range = undefined }
  }
  if (!parts.length) throw new MotionProviderError('Motion playlist')
  return parts
}

function tokenExpiry(token: string, kid?: string): number | null {
  try {
    const [header, payload] = token.split('.').slice(0, 2).map(part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')))
    if (kid && header?.kid !== kid) return null
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : null
  } catch { return null }
}

export class AppleMotion implements MotionProvider {
  private token: { value: string; expires: number } | undefined
  private tokenRequest: Promise<string> | undefined
  constructor(private fetcher: Fetcher = fetch, private store = process.env.OPENFY_MOTION_STOREFRONT || 'us', private now: () => number = Date.now) {
    if (!/^[a-z]{2}$/.test(this.store)) this.store = 'us'
  }

  private async request(url: string, headers: Record<string, string> = {}, signal?: AbortSignal, redirect: RequestRedirect = 'error') {
    try {
      return await this.fetcher(url, { headers: { 'User-Agent': AGENT, ...headers }, redirect,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new MotionProviderError('Motion provider unavailable')
    }
  }
  /** Only the player's own pages may redirect, and only within the player's host. */
  private async text(url: string, limit: number, signal?: AbortSignal, redirect: RequestRedirect = 'error') {
    const response = await this.request(url, {}, signal, redirect)
    if (redirect === 'follow' && response.url && new URL(response.url).origin !== PLAYER) throw new MotionProviderError('Motion redirect')
    if (!response.ok) throw new MotionProviderError(`Motion HTTP ${response.status}`)
    const body = await response.text().catch(() => { throw new MotionProviderError('Motion response') })
    if (body.length > limit) throw new MotionProviderError('Motion response size')
    return body
  }

  /** The web player ships a developer token in its main bundle; it lasts for months. */
  private playerToken() {
    if (this.token && this.token.expires - 3_600_000 > this.now()) return Promise.resolve(this.token.value)
    this.tokenRequest ||= (async () => {
      const page = await this.text(`${PLAYER}/${this.store}/browse`, 4 * 1024 ** 2, undefined, 'follow')
      const bundles = [...page.matchAll(/src="(\/assets\/index[^"]+?\.js)"/g)].map(match => match[1]!)
      for (const bundle of bundles.slice(0, 3)) {
        const script = await this.text(PLAYER + bundle, 32 * 1024 ** 2, undefined, 'follow')
        const candidates = script.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) || []
        const value = candidates.find(candidate => tokenExpiry(candidate, 'WebPlayKid')) || candidates.find(candidate => tokenExpiry(candidate))
        if (value) { this.token = { value, expires: tokenExpiry(value)! }; return value }
      }
      throw new MotionProviderError('Motion token')
    })().finally(() => { this.tokenRequest = undefined })
    return this.tokenRequest
  }

  /** Shared authentication and one token renewal for catalog searches and details. */
  private async catalog(path: string, query: Record<string, string> = {}) {
    for (let attempt = 0; ; attempt++) {
      const url = new URL(`https://amp-api.music.apple.com/v1/catalog/${this.store}/${path}`)
      url.search = new URLSearchParams(query).toString()
      const response = await this.request(url.href,
        { Authorization: `Bearer ${await this.playerToken()}`, Origin: PLAYER, Accept: 'application/json' })
      if ((response.status === 401 || response.status === 403) && attempt === 0) { this.token = undefined; continue }
      if (response.status === 404 && /^(albums|artists)\//.test(path)) return undefined
      if (!response.ok) throw new MotionProviderError(`Motion HTTP ${response.status}`)
      const body = await response.json().catch(() => null)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MotionProviderError('Motion response')
      return body
    }
  }

  private matches(signature: MotionSignature, title: string, artist: string) {
    return motionMetadataKey(title) === motionMetadataKey(signature.album)
      && signature.artists.some(name => metadataKey(name) ? sameArtist({ artistName: artist }, [name])
        : motionMetadataKey(artist) === motionMetadataKey(name))
  }

  private async itunes(signature: MotionSignature): Promise<number[]> {
    const url = new URL('https://itunes.apple.com/search')
    for (const [key, value] of Object.entries({ term: `${signature.artists[0]} ${signature.album}`, media: 'music', entity: 'album', limit: '25', country: this.store })) url.searchParams.set(key, value)
    const response = await this.request(url.href, { Accept: 'application/json' })
    if (!response.ok) throw new MotionProviderError(`iTunes HTTP ${response.status}`)
    const body = await response.json().catch(() => null) as { results?: { wrapperType?: string; collectionId?: number; collectionName?: string; artistName?: string }[] } | null
    if (!Array.isArray(body?.results)) throw new MotionProviderError('iTunes response')
    return body.results.filter(result => result.wrapperType === 'collection' && this.matches(signature, result.collectionName || '', result.artistName || ''))
      .map(result => {
        if (!Number.isSafeInteger(result.collectionId) || result.collectionId! < 1) throw new MotionProviderError('iTunes album ID')
        return result.collectionId!
      })
  }

  private async apple(signature: MotionSignature): Promise<number[]> {
    const body = await this.catalog('search', { term: `${signature.artists[0]} ${signature.album}`, types: 'albums', limit: '25' })
    if (!body?.results || typeof body.results !== 'object' || Array.isArray(body.results)) throw new MotionProviderError('Motion search response')
    const albums = body.results.albums
    if (albums === undefined) return []
    if (!Array.isArray(albums?.data)) throw new MotionProviderError('Motion search response')
    return albums.data.filter((row: { type?: string; attributes?: { name?: string; artistName?: string } }) => row.type === 'albums'
      && this.matches(signature, row.attributes?.name || '', row.attributes?.artistName || ''))
      .map((row: { id?: string }) => {
        if (typeof row.id !== 'string' || !/^\d+$/.test(row.id) || !Number.isSafeInteger(Number(row.id)) || Number(row.id) < 1) throw new MotionProviderError('Motion album ID')
        return Number(row.id)
      })
  }

  private async album(id: number): Promise<{ status: 'ready'; master: string } | { status: 'none' | 'missing' }> {
    const body = await this.catalog(`albums/${id}`, { extend: 'editorialVideo' })
    if (!body) return { status: 'missing' }
    if (!Array.isArray(body.data)) throw new MotionProviderError('Motion album response')
    if (!body.data.length) return { status: 'missing' }
    const attributes = body.data[0]?.attributes
    if (!attributes || typeof attributes !== 'object') throw new MotionProviderError('Motion album response')
    const video = attributes.editorialVideo
    if (video != null && (typeof video !== 'object' || Array.isArray(video))) throw new MotionProviderError('Motion video response')
    const master = video?.motionDetailSquare?.video || video?.motionSquareVideo1x1?.video
    if (master != null && typeof master !== 'string') throw new MotionProviderError('Motion video response')
    return master ? { status: 'ready', master: motionUrl(master) } : { status: 'none' }
  }

  /** iTunes first, Apple Music second; every method keeps the same strict album/artist match. */
  async find(signature: MotionSignature): Promise<MotionLookup> {
    if (!motionMetadataKey(signature.album) || !signature.artists[0] || !motionMetadataKey(signature.artists[0])) return { status: 'unmatched' }
    const target = createHash('sha256').update(`${motionMetadataKey(signature.artists[0])}\n${motionMetadataKey(signature.album)}`).digest('hex').slice(0, 12)
    const checked = new Set<number>(), verified = new Set<number>(), unresolved = new Set<number>()
    let failure: unknown
    for (const method of ['itunes', 'apple-music'] as const) {
      const started = performance.now()
      sessionDiagnostic('motion.search', 'started', { target, method })
      try {
        const ids = [...new Set(await (method === 'itunes' ? this.itunes(signature) : this.apple(signature)))]
        const candidates = ids.filter(id => !checked.has(id))
        for (const id of candidates.slice(MAX_CANDIDATES)) unresolved.add(id)
        for (const id of candidates.slice(0, MAX_CANDIDATES)) {
          checked.add(id)
          try {
            const result = await this.album(id)
            if (result.status === 'ready') {
              sessionDiagnostic('motion.search', 'ready', { target, method, albumId: id, elapsedMs: Math.round(performance.now() - started) })
              return { status: 'ready', source: { albumId: id, master: result.master } }
            }
            if (result.status === 'none') { verified.add(id); unresolved.delete(id) }
            else unresolved.add(id)
            sessionDiagnostic('motion.candidate', result.status, { target, method, albumId: id })
          } catch (error) { failure = error; sessionDiagnostic('motion.candidate', 'failed', { target, method, albumId: id, ...diagnosticError(error) }) }
        }
        sessionDiagnostic('motion.search', 'completed', { target, method, candidates: ids.length, elapsedMs: Math.round(performance.now() - started) })
      } catch (error) { failure = error; sessionDiagnostic('motion.search', 'failed', { target, method, ...diagnosticError(error), elapsedMs: Math.round(performance.now() - started) }) }
    }
    // A failed method or detail lookup cannot establish that the album has no motion art.
    if (failure) throw failure instanceof MotionProviderError ? failure : new MotionProviderError('Motion search unavailable')
    return verified.size && !unresolved.size ? { status: 'none', albumIds: [...verified] } : { status: 'unmatched' }
  }

  private async artistCandidates(name: string, key: string): Promise<number[]> {
    const body = await this.catalog('search', { term: name, types: 'artists', limit: '10' })
    if (!body?.results || typeof body.results !== 'object' || Array.isArray(body.results)) throw new MotionProviderError('Respuesta de búsqueda de artistas inválida')
    const artists = body.results.artists
    if (artists === undefined) return []
    if (!Array.isArray(artists?.data)) throw new MotionProviderError('Respuesta de búsqueda de artistas inválida')
    const ids = new Set<number>()
    for (const row of artists.data) {
      if (row?.type !== 'artists') continue
      if (typeof row.attributes?.name !== 'string') throw new MotionProviderError('Nombre de artista inválido')
      if (motionMetadataKey(row.attributes.name) !== key) continue
      const id = Number(row.id)
      if (typeof row.id !== 'string' || !/^\d+$/.test(row.id) || !Number.isSafeInteger(id) || id < 1) throw new MotionProviderError('ID de artista inválido')
      ids.add(id)
      if (ids.size === MAX_CANDIDATES) break
    }
    return [...ids]
  }

  private async artist(id: number, albums: Set<string>): Promise<
    { status: 'ready'; master: string; albumKeys: string[] } | { status: 'missing' | 'unmatched' | 'none' }
  > {
    const body = await this.catalog('artists/' + id, { extend: 'editorialVideo', include: 'albums' })
    if (!body) return { status: 'missing' }
    if (!Array.isArray(body.data)) throw new MotionProviderError('Respuesta del catálogo de artistas inválida')
    if (!body.data.length) return { status: 'missing' }
    const row = body.data[0]
    const attributes = row?.attributes
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) throw new MotionProviderError('Respuesta del catálogo de artistas inválida')
    const related = row.relationships?.albums
    if (related === undefined) return { status: 'unmatched' }
    if (!Array.isArray(related?.data)) throw new MotionProviderError('Respuesta de álbumes del artista inválida')
    const albumKeys = new Set<string>()
    for (const album of related.data) {
      if (typeof album?.attributes?.name !== 'string') throw new MotionProviderError('Título de álbum inválido')
      const key = artistAlbumKey(album.attributes.name)
      if (key) albumKeys.add(key)
    }
    if (![...albumKeys].some(key => albums.has(key))) return { status: 'unmatched' }
    const video = attributes.editorialVideo
    if (video != null && (typeof video !== 'object' || Array.isArray(video))) throw new MotionProviderError('Respuesta de vídeo inválida')
    const master = video?.motionArtistWide16x9?.video || video?.motionArtistFullscreen16x9?.video
    if (master != null && typeof master !== 'string') throw new MotionProviderError('Respuesta de vídeo inválida')
    return master ? { status: 'ready', master: motionUrl(master), albumKeys: [...albumKeys] } : { status: 'none' }
  }

  async findArtist(signature: ArtistMotionSignature): Promise<ArtistMotionLookup> {
    const key = motionMetadataKey(signature.name)
    const albums = new Set(signature.albums.map(artistAlbumKey).filter(Boolean))
    if (!key || !albums.size) return { status: 'unmatched' }
    const target = createHash('sha256').update('artist\n' + key).digest('hex').slice(0, 12)
    const method = 'apple-music'
    const started = performance.now()
    sessionDiagnostic('motion.search', 'started', { target, method })
    try {
      const ids = await this.artistCandidates(signature.name, key)
      const verified: number[] = []
      const ready: { artistId: number; master: string; albumKeys: string[] }[] = []
      let failure: unknown
      // Every candidate is checked: two namesakes sharing a release title must not let provider order pick a face.
      for (const artistId of ids) {
        try {
          const result = await this.artist(artistId, albums)
          if (result.status === 'ready') ready.push({ artistId, master: result.master, albumKeys: result.albumKeys })
          else if (result.status === 'none') verified.push(artistId)
          sessionDiagnostic('motion.candidate', result.status, { target, method, artistId })
        } catch (error) {
          failure = error
          sessionDiagnostic('motion.candidate', 'failed', { target, method, artistId, ...diagnosticError(error) })
        }
      }
      if (failure) throw failure
      sessionDiagnostic('motion.search', 'completed', { target, method, candidates: ids.length, elapsedMs: Math.round(performance.now() - started) })
      // More than one catalogue artist matched the name and a release: with doubt, nothing is shown.
      if (ready.length + verified.length > 1) return { status: 'unmatched' }
      if (ready.length === 1) return { status: 'ready', source: ready[0]! }
      return verified.length ? { status: 'none', artistIds: verified } : { status: 'unmatched' }
    } catch (error) {
      sessionDiagnostic('motion.search', 'failed', { target, method, ...diagnosticError(error), elapsedMs: Math.round(performance.now() - started) })
      throw error instanceof MotionProviderError ? error : new MotionProviderError('Búsqueda de artistas no disponible')
    }
  }

  /** Writes the fragmented MP4 exactly as served: initialization section followed by its segments. */
  async download(master: string, destination: string, signal?: AbortSignal, kind: MotionKind = 'album') {
    const source = motionUrl(master)
    const variant = motionVariant(await this.text(source, 1024 ** 2, signal), source, kind)
    if (!variant) throw new MotionProviderError('Motion variant')
    const parts = motionParts(await this.text(variant.url, 1024 ** 2, signal), variant.url)
    const declared = parts.reduce((sum, part) => sum + (part.length || 0), 0)
    if (declared > MAX_MOTION_BYTES || parts.length > 400) throw new MotionProviderError('Motion size')
    const output = createWriteStream(destination)
    let bytes = 0
    try {
      for (const part of parts) {
        const ranged = part.start !== undefined
        const response = await this.request(part.url, ranged ? { Range: `bytes=${part.start}-${part.start! + part.length! - 1}` } : {}, signal)
        if (!response.body || response.status !== (ranged ? 206 : 200)) { await response.body?.cancel().catch(() => {}); throw new MotionProviderError(`Motion HTTP ${response.status}`) }
        let received = 0
        const count = new Transform({ transform(chunk, _encoding, callback) {
          received += chunk.length; bytes += chunk.length
          callback(bytes > MAX_MOTION_BYTES || ranged && received > part.length! ? new MotionProviderError('Motion size') : null, chunk)
        } })
        await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), count, output, { end: false, signal })
        if (ranged && received !== part.length) throw new MotionProviderError('Motion incomplete')
      }
      output.end()
      await finished(output)
    } catch (error) {
      output.destroy()
      if (error instanceof MotionProviderError || signal?.aborted) throw error
      throw new MotionProviderError('Motion download')
    }
    if (!bytes) throw new MotionProviderError('Motion empty')
    return { width: variant.width, height: variant.height }
  }
}
