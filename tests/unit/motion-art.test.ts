import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppleMotion, MotionProviderError, motionParts, motionUrl, motionVariant, type MotionProvider, type MotionSignature, type MotionLookup } from '../../server/utils/apple-motion'
import { MotionCache, completeNextMotionArt, motionArtChanged, motionArtDelay, motionKey, pinnedMotion, setMotionCache, songMotionSignature, trackMotionSignature } from '../../server/utils/motion-art'
import { closeDatabase, getDatabase } from '../../server/database'
import { tracks, youtubeAudio, youtubeSongs } from '../../server/database/schema'

const HOST = 'https://mvod.itunes.apple.com/assets/'
const master = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=2056052,CODECS="avc1.64001f",RESOLUTION=768x768', `${HOST}v768.m3u8`,
  '#EXT-X-STREAM-INF:BANDWIDTH=4787437,CODECS="hvc1.2.20000000.L123.B0",RESOLUTION=1080x1080', `${HOST}hevc1080.m3u8`,
  '#EXT-X-STREAM-INF:BANDWIDTH=3924709,CODECS="avc1.640020",RESOLUTION=1080x1080', 'v1080-low.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=5031816,CODECS="avc1.640020",RESOLUTION=1080x1080', 'v1080-mid.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=7057861,CODECS="avc1.640020",RESOLUTION=1080x1080', 'v1080-high.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=9155283,CODECS="avc1.640033",RESOLUTION=2160x2160', 'v2160.m3u8',
].join('\n')
const playlist = [
  '#EXTM3U', '#EXT-X-MAP:URI="clip.mp4",BYTERANGE="4@0"',
  '#EXTINF:5.7,', '#EXT-X-BYTERANGE:6@4', 'clip.mp4',
  '#EXTINF:2.9,', '#EXT-X-BYTERANGE:5', 'clip.mp4', '#EXT-X-ENDLIST',
].join('\n')
const signature: MotionSignature = { artists: ['IVE'], album: 'REVIVE+' }
const found = (albumId: number): MotionLookup => ({ status: 'ready', source: { albumId, master: `${HOST}master.m3u8` } })

describe('motion playlists', () => {
  it('chooses the largest H.264 rendition up to 1080 px at a moderate bitrate', () => {
    expect(motionVariant(master, `${HOST}master.m3u8`)).toEqual({ url: `${HOST}v1080-mid.m3u8`, width: 1080, height: 1080, bandwidth: 5031816 })
    expect(motionVariant('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="hvc1.2",RESOLUTION=360x360\nx.m3u8', `${HOST}m.m3u8`)).toBeNull()
  })
  it('merges adjacent byte ranges, including an implicit offset', () => {
    expect(motionParts(playlist, `${HOST}v.m3u8`)).toEqual([{ url: `${HOST}clip.mp4`, start: 0, length: 15 }])
    expect(motionParts('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\nseg1.m4s\n#EXTINF:1,\nseg2.m4s', `${HOST}v.m3u8`).map(part => part.url))
      .toEqual([`${HOST}init.mp4`, `${HOST}seg1.m4s`, `${HOST}seg2.m4s`])
  })
  it('rejects encrypted media and hosts outside the provider', () => {
    expect(() => motionParts('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:1,\nseg.m4s', `${HOST}v.m3u8`)).toThrow(MotionProviderError)
    expect(() => motionParts('#EXTM3U\n#EXTINF:1,\nhttps://example.com/seg.m4s', `${HOST}v.m3u8`)).toThrow(MotionProviderError)
    for (const url of ['http://mvod.itunes.apple.com/a.m3u8', 'https://apple.com.evil.test/a', 'https://user@mvod.itunes.apple.com/a', 'https://mvod.itunes.apple.com:8443/a'])
      expect(() => motionUrl(url)).toThrow(MotionProviderError)
  })
})

const jwt = (kid: string, exp: number) => [{ alg: 'ES256', kid }, { exp }].map(part => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') + '.signature'
function provider(options: { results?: object[]; appleResults?: object[]; video?: object | null; videos?: Record<string, object | null>; unauthorized?: number; itunesStatus?: number; appleStatus?: number; malformedSearch?: boolean } = {}) {
  let unauthorized = options.unauthorized || 0, issued = 0
  const calls: { url: string; headers: Record<string, string> }[] = []
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), headers = (init?.headers || {}) as Record<string, string>
    calls.push({ url, headers })
    if (url.startsWith('https://itunes.apple.com/search')) return Response.json({ results: options.results ?? [
      { wrapperType: 'collection', collectionId: 11, collectionName: 'REVIVE+ (Deluxe)', artistName: 'IVE' },
      { wrapperType: 'collection', collectionId: 12, collectionName: 'Revive+', artistName: 'Another Band' },
      { wrapperType: 'collection', collectionId: 13, collectionName: 'REVIVE+ - EP', artistName: 'IVE' },
    ] }, { status: options.itunesStatus || 200 })
    if (url === 'https://music.apple.com/us/browse') return new Response('<script type="module" crossorigin src="/assets/index~abc.js"></script>')
    if (url === 'https://music.apple.com/assets/index~abc.js') return new Response(`x="${jwt('Other', 1)}";y="${jwt('WebPlayKid', 4102444800 + issued++)}"`)
    if (url.startsWith('https://amp-api.music.apple.com/')) {
      if (unauthorized-- > 0) return new Response('', { status: 401 })
      if (new URL(url).pathname.endsWith('/search')) return Response.json(options.malformedSearch ? { results: { albums: {} } } : { results: { albums: { data: options.appleResults || [] } } }, { status: options.appleStatus || 200 })
      const id = new URL(url).pathname.split('/').pop()!
      const video = options.videos && Object.hasOwn(options.videos, id) ? options.videos[id] : options.video
      return Response.json({ data: [{ attributes: { editorialVideo: video === undefined ? { motionDetailSquare: { video: `${HOST}master.m3u8` } } : video } }] })
    }
    if (url === `${HOST}master.m3u8`) return new Response(master)
    if (url === `${HOST}v1080-mid.m3u8`) return new Response(playlist)
    if (url === `${HOST}clip.mp4`) return headers.Range === 'bytes=0-14' ? new Response('0123456789abcde', { status: 206 }) : new Response('whole file')
    return new Response('', { status: 404 })
  })
  return { request, calls, client: new AppleMotion(request as typeof fetch, 'us') }
}

describe('Apple motion provider', () => {
  it('matches symbolic album and artist names without confusing unrelated punctuation', async () => {
    const symbolicAlbum = provider({ results: [
      { wrapperType: 'collection', collectionId: 1, collectionName: '!!!', artistName: 'XXXTENTACION' },
      { wrapperType: 'collection', collectionId: 2, collectionName: '?', artistName: 'XXXTENTACION' },
    ] })
    expect(await symbolicAlbum.client.find({ artists: ['XXXTENTACION'], album: '?' })).toEqual(found(2))
    const symbolicArtist = provider({ results: [
      { wrapperType: 'collection', collectionId: 3, collectionName: 'VULTURES 1', artistName: '!!!' },
      { wrapperType: 'collection', collectionId: 4, collectionName: 'VULTURES 1', artistName: '¥$' },
    ] })
    expect(await symbolicArtist.client.find({ artists: ['¥$'], album: 'VULTURES 1' })).toEqual(found(4))
  })
  it('accepts only the same album by the same artist and reuses the player token', async () => {
    const { client, calls } = provider()
    expect(await client.find(signature)).toEqual(found(13))
    expect(await client.find({ artists: ['IVE'], album: 'Revive' })).toEqual(found(13))
    const catalog = calls.filter(call => call.url.includes('amp-api'))
    expect(catalog.map(call => call.url)).toEqual(Array(2).fill('https://amp-api.music.apple.com/v1/catalog/us/albums/13?extend=editorialVideo'))
    expect(catalog[0]!.headers.Authorization).toMatch(/^Bearer eyJ/)
    expect(calls.filter(call => call.url.endsWith('/us/browse'))).toHaveLength(1)
    expect(new URL(calls[0]!.url).searchParams.get('term')).toBe('IVE REVIVE+')
  })
  it('separates unmatched albums from verified albums without a square video', async () => {
    const unmatched = provider({ results: [{ wrapperType: 'collection', collectionId: 1, collectionName: 'REVIVE+ Remixes', artistName: 'IVE' }] })
    expect(await unmatched.client.find(signature)).toEqual({ status: 'unmatched' })
    expect(unmatched.calls.some(call => call.url.includes('/search?') && call.url.includes('amp-api'))).toBe(true)
    expect(unmatched.calls.some(call => call.url.includes('/albums/'))).toBe(false)
    expect(await provider({ video: null }).client.find(signature)).toEqual({ status: 'none', albumIds: [13] })
    expect(await provider({ video: { motionDetailTall: { video: `${HOST}tall.m3u8` } } }).client.find(signature)).toEqual({ status: 'none', albumIds: [13] })
    await expect(provider({ video: { motionDetailSquare: { video: 'https://example.com/master.m3u8' } } }).client.find(signature)).rejects.toThrow(MotionProviderError)
  })
  it('renews a rejected token once and reports a provider failure after that', async () => {
    const renewed = provider({ unauthorized: 1 })
    expect(await renewed.client.find(signature)).toEqual(found(13))
    expect(renewed.calls.filter(call => call.url.endsWith('/us/browse'))).toHaveLength(2)
    await expect(provider({ unauthorized: 2 }).client.find(signature)).rejects.toThrow(MotionProviderError)
  })

  it('finds Un Verano Sin Ti through Apple Music when iTunes omits it', async () => {
    const { client, calls } = provider({ results: [], appleResults: [
      { id: '1622045624', type: 'albums', attributes: { name: 'Un Verano Sin Ti', artistName: 'Bad Bunny' } },
    ] })
    expect(await client.find({ artists: ['Bad Bunny'], album: 'Un Verano Sin Ti' })).toEqual(found(1622045624))
    const search = new URL(calls.find(call => call.url.includes('/us/search?'))!.url)
    expect(search.searchParams.get('term')).toBe('Bad Bunny Un Verano Sin Ti')
    expect(search.searchParams.get('types')).toBe('albums')
  })

  it('tries a different Apple candidate after an iTunes album without video, checking each ID once', async () => {
    const { client, calls } = provider({ videos: { '13': null }, appleResults: [
      { id: '13', type: 'albums', attributes: { name: 'REVIVE+', artistName: 'IVE' } },
      { id: '14', type: 'albums', attributes: { name: 'REVIVE+', artistName: 'IVE' } },
    ] })
    expect(await client.find(signature)).toEqual(found(14))
    expect(calls.filter(call => call.url.includes('/albums/13?'))).toHaveLength(1)
  })

  it('recovers from an iTunes error with Apple and never records an incomplete search as an absence', async () => {
    const appleResults = [{ id: '14', type: 'albums', attributes: { name: 'REVIVE+', artistName: 'IVE' } }]
    expect(await provider({ itunesStatus: 429, appleResults }).client.find(signature)).toEqual(found(14))
    await expect(provider({ video: null, appleStatus: 503 }).client.find(signature)).rejects.toThrow(MotionProviderError)
    await expect(provider({ results: [], malformedSearch: true }).client.find(signature)).rejects.toThrow(MotionProviderError)
    await expect(provider({ itunesStatus: 503 }).client.find(signature)).rejects.toThrow(MotionProviderError)
  })

  it('rejects different artists, editions and malformed IDs from the fallback', async () => {
    const appleResults = [
      { id: '1', type: 'albums', attributes: { name: 'REVIVE+ (Deluxe)', artistName: 'IVE' } },
      { id: '2', type: 'albums', attributes: { name: 'REVIVE+', artistName: 'Other Artist' } },
    ]
    expect(await provider({ results: [], appleResults }).client.find(signature)).toEqual({ status: 'unmatched' })
    await expect(provider({ results: [], appleResults: [{ id: 'bad-id', type: 'albums', attributes: { name: 'REVIVE+', artistName: 'IVE' } }] }).client.find(signature)).rejects.toThrow(MotionProviderError)
  })
  it('downloads the chosen rendition by range into one file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openfy-motion-download-'))
    try {
      const { client, calls } = provider(), file = join(root, 'raw.part')
      expect(await client.download(`${HOST}master.m3u8`, file)).toEqual({ width: 1080, height: 1080 })
      expect(await readFile(file, 'utf8')).toBe('0123456789abcde')
      expect(calls.at(-1)!.headers.Range).toBe('bytes=0-14')
      const ignored = new AppleMotion((async (input: string | URL | Request) => {
        const url = String(input)
        return url.endsWith('master.m3u8') ? new Response(master) : url.endsWith('.m3u8') ? new Response(playlist) : new Response('whole file', { status: 200 })
      }) as typeof fetch)
      await expect(ignored.download(`${HOST}master.m3u8`, file)).rejects.toThrow(MotionProviderError)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

describe('motion cache', () => {
  let root: string, staging: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'openfy-motion-')); staging = await mkdtemp(join(tmpdir(), 'openfy-motion-staging-')) })
  afterEach(async () => { vi.useRealTimers(); delete process.env.OPENFY_MOTION_ART; await rm(root, { recursive: true, force: true }); await rm(staging, { recursive: true, force: true }) })
  const remux = async (raw: string, output: string) => { await copyFile(raw, output) }
  function fake(found: (signature: MotionSignature) => boolean = () => true, bytes = 1000) {
    const find = vi.fn(async (value: MotionSignature): Promise<MotionLookup> => found(value) ? { status: 'ready', source: { albumId: 7, master: `${HOST}master.m3u8` } } : { status: 'none', albumIds: [7] })
    const download = vi.fn(async (_master: string, destination: string) => { await writeFile(destination, Buffer.alloc(bytes, 1)); return { width: 1080, height: 1080 } })
    return { find, download } satisfies MotionProvider
  }
  const album = (id: number): MotionSignature => ({ artists: ['Openfy'], album: `Album ${id}` })

  it('fetches an album once for concurrent requests and reopens it without the provider', async () => {
    const source = fake(), cache = new MotionCache(root, staging, () => new Set(), source, remux)
    const [first, second] = await Promise.all([cache.resolve(signature), cache.resolve({ artists: ['IVE', 'Guest'], album: 'revive' })])
    expect(first).toEqual(second)
    expect(first).toMatchObject({ key: motionKey(signature), bytes: 1000, width: 1080, height: 1080 })
    expect(source.find).toHaveBeenCalledTimes(1)
    expect(await readdir(staging)).toEqual([])
    const offline = new MotionCache(root, staging, () => new Set(), { find: async () => { throw new MotionProviderError('offline') }, download: async () => { throw new MotionProviderError('offline') } }, remux)
    expect(await offline.resolve(signature)).toEqual(first)
    expect(await offline.file(first!.key)).toEqual(first)
    expect(await offline.file('../' + first!.key)).toBeNull()
  })

  it('remembers an album without a video for thirty days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const source = fake(() => false), cache = new MotionCache(root, staging, () => new Set(), source, remux)
    expect(await cache.resolve(signature)).toBeNull()
    expect(await cache.resolve(signature)).toBeNull()
    expect(source.find).toHaveBeenCalledTimes(1)
    expect(await cache.file(motionKey(signature))).toBeNull()
    vi.setSystemTime(Date.now() + 31 * 24 * 3_600_000)
    expect(await cache.resolve(signature)).toBeNull()
    expect(source.find).toHaveBeenCalledTimes(2)
  })

  it('retries unmatched albums after a day instead of caching them as verified absences', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const find = vi.fn(async (): Promise<MotionLookup> => ({ status: 'unmatched' }))
    const cache = new MotionCache(root, staging, () => new Set(), { find, download: vi.fn() })
    expect(await cache.lookup(signature)).toEqual({ status: 'unmatched', retryAfterMs: 86_400_000 })
    vi.setSystemTime(Date.now() + 60_000)
    expect(await cache.lookup(signature)).toEqual({ status: 'unmatched', retryAfterMs: 86_340_000 })
    expect(find).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 86_400_000)
    await cache.lookup(signature)
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('invalidates legacy negatives, preserves legacy videos, and repairs incomplete folders', async () => {
    const source = fake(), cache = new MotionCache(root, staging, () => new Set([motionKey(signature)]), source, remux)
    const dir = join(root, motionKey(signature)), meta = join(dir, 'metadata.json')
    await mkdir(dir, { recursive: true })
    await writeFile(meta, JSON.stringify({ version: 1, status: 'none', checkedAt: Date.now(), accessed: Date.now() }))
    expect((await cache.schedule()).get(motionKey(signature))).toBe(0)
    const ready = await cache.resolve(signature)
    const previous = JSON.parse(await readFile(meta, 'utf8')); delete previous.resolverRevision
    await writeFile(meta, JSON.stringify(previous))
    expect((await cache.schedule()).get(motionKey(signature))).toBe(Infinity)
    expect(await cache.resolve(signature)).toEqual(ready)
    expect(source.download).toHaveBeenCalledTimes(1)
    await rm(ready!.path)
    expect((await cache.schedule()).get(motionKey(signature))).toBe(0)
    await cache.resolve(signature)
    expect(source.download).toHaveBeenCalledTimes(2)
  })

  it('does not record a provider failure as an absence, and waits before asking again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let online = false
    const source = fake(), find = vi.fn(async (value: MotionSignature) => { if (!online) throw new MotionProviderError('offline'); return source.find(value) })
    const cache = new MotionCache(root, staging, () => new Set(), { find, download: source.download }, remux)
    await expect(cache.resolve(signature)).rejects.toThrow(MotionProviderError)
    expect(await readdir(root)).toEqual([])
    online = true
    await expect(cache.resolve(signature)).rejects.toThrow(MotionProviderError)
    expect(find).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 16 * 60_000)
    expect(await cache.resolve(signature)).toMatchObject({ bytes: 1000 })
    const broken = new MotionCache(root, staging, () => new Set(), source, async () => { throw new Error('ffmpeg') })
    await expect(broken.resolve(album(9))).rejects.toThrow(MotionProviderError)
    expect(await readdir(staging)).toEqual([])
    expect(await readdir(root)).toEqual([motionKey(signature)])
  })

  it('keeps pinned albums when evicting the least recently shown ones over the budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const pins = new Set([motionKey(album(0))])
    const cache = new MotionCache(root, staging, () => pins, fake(), remux, 1500)
    const pinned = await cache.resolve(album(0))
    vi.setSystemTime(Date.now() + 1000); const older = await cache.resolve(album(1))
    vi.setSystemTime(Date.now() + 1000); const newer = await cache.resolve(album(2))
    await cache.prune()
    expect((await stat(older!.path)).isFile()).toBe(true) // shown moments ago
    vi.setSystemTime(Date.now() + 180_000)
    await cache.prune()
    expect((await stat(pinned!.path)).isFile()).toBe(true)
    expect((await stat(newer!.path)).isFile()).toBe(true)
    await expect(stat(older!.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serves stored videos but contacts nobody when the feature is off', async () => {
    const source = fake(), cache = new MotionCache(root, staging, () => new Set(), source, remux)
    const stored = await cache.resolve(album(1))
    process.env.OPENFY_MOTION_ART = 'off'
    expect(await cache.resolve(album(1))).toEqual(stored)
    expect(await cache.resolve(album(2))).toBeNull()
    expect(source.find).toHaveBeenCalledTimes(1)
    expect(motionArtDelay()).toBeNull()
  })
})

describe('motion signatures and background completion', () => {
  let root: string
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000); root = await mkdtemp(join(tmpdir(), 'openfy-motion-library-')); process.env.OPENFY_DATA_DIR = root })
  afterEach(async () => { setMotionCache(undefined); closeDatabase(); delete process.env.OPENFY_DATA_DIR; vi.useRealTimers(); await rm(root, { recursive: true, force: true }) })
  function addTrack(album: string, artist = 'Openfy') {
    const id = randomUUID()
    getDatabase().insert(tracks).values({ id, hash: id, originalId: randomUUID(), conversion: 'ready',
      metadata: { id, title: 'Canción', artist, albumArtist: artist, album, albumId: id, duration: 1, trackNumber: 1, disc: 1, year: null, format: 'FLAC', artwork: null, palette: [], addedAt: 1 } }).run()
  }

  it('needs a real album and artist, and shares one key per album', () => {
    expect(songMotionSignature({ artists: ['IVE'], album: null })).toBeNull()
    expect(songMotionSignature({ artists: [], album: 'REVIVE+' })).toBeNull()
    expect(trackMotionSignature({ artist: 'Artista desconocido', albumArtist: 'Artista desconocido', album: 'REVIVE+' })).toBeNull()
    expect(trackMotionSignature({ artist: 'IVE', albumArtist: 'IVE', album: 'Sin álbum' })).toBeNull()
    expect(trackMotionSignature({ artist: 'IVE', albumArtist: 'IVE', album: 'REVIVE+' })).toEqual({ artists: ['IVE'], album: 'REVIVE+' })
    expect(motionKey({ artists: ['IVE', 'Guest'], album: 'Revive+' })).toBe(motionKey(signature))
    expect(motionKey({ artists: ['IVE'], album: 'REVIVE+ (Deluxe)' })).not.toBe(motionKey(signature))
    expect(songMotionSignature({ artists: ['XXXTENTACION'], album: '?' })).not.toBeNull()
    expect(songMotionSignature({ artists: ['¥$'], album: 'VULTURES 1' })).not.toBeNull()
    expect(motionKey({ artists: ['XXXTENTACION'], album: '?' })).not.toBe(motionKey({ artists: ['XXXTENTACION'], album: '!!!' }))
  })

  it('backfills twelve previously downloaded songs with one shared video and reuses it after restarting', async () => {
    const db = getDatabase()
    for (let index = 0; index < 12; index++) {
      const videoId = `downloaded-${index}`
      db.insert(youtubeSongs).values({ videoId, addedAt: 1, song: { videoId, title: `Canción ${index}`,
        artists: index % 2 ? ['Bad Bunny', 'Invitado'] : ['Bad Bunny'], album: 'Un Verano Sin Ti', artwork: null, duration: 1 } }).run()
      db.insert(youtubeAudio).values({ videoId, assetId: `audio-${index}`, duration: 1, palette: [], downloadedAt: 1 }).run()
    }
    expect(pinnedMotion().size).toBe(1)
    const find = vi.fn(async () => found(123))
    const download = vi.fn(async (_master: string, destination: string) => { await writeFile(destination, Buffer.alloc(1000)); return { width: 1080, height: 1080 } })
    const cacheRoot = join(root, 'motion-cache'), staging = join(root, 'staging')
    const create = () => new MotionCache(cacheRoot, staging, () => new Set(pinnedMotion().keys()), { find, download }, copyFile)
    setMotionCache(create())
    await completeNextMotionArt()
    expect(motionArtDelay()).toBeNull()
    expect(find).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledTimes(1)
    expect(await readdir(cacheRoot)).toEqual([...pinnedMotion().keys()])
    setMotionCache(create())
    await completeNextMotionArt()
    expect(motionArtDelay()).toBeNull()
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('paces albums and wakes a failing album again without a library change', async () => {
    addTrack('Uno'); addTrack('Uno'); addTrack('Roto'); addTrack('Sin álbum')
    expect([...pinnedMotion().values()].map(value => value.album).sort()).toEqual(['Roto', 'Uno'])
    let online = false
    const find = vi.fn(async (value: MotionSignature): Promise<MotionLookup> => { if (value.album === 'Roto' && !online) throw new MotionProviderError('offline'); return { status: 'none', albumIds: [7] } })
    setMotionCache(new MotionCache(join(root, 'motion-cache'), join(root, 'staging'), () => new Set(pinnedMotion().keys()), { find, download: async () => ({ width: 1, height: 1 }) }))
    await completeNextMotionArt()
    expect(motionArtDelay()).toBe(6000)
    vi.setSystemTime(Date.now() + 6000); await completeNextMotionArt()
    expect(find.mock.calls.map(call => call[0].album).sort()).toEqual(['Roto', 'Uno'])
    expect(motionArtDelay()).toBe(15 * 60_000)
    online = true; vi.setSystemTime(Date.now() + 15 * 60_000)
    expect(motionArtDelay()).toBe(0)
    await completeNextMotionArt()
    expect(find.mock.calls.map(call => call[0].album)).toEqual(['Uno', 'Roto', 'Roto'])
    expect(motionArtDelay()).toBeGreaterThan(29 * 24 * 3_600_000)
    addTrack('Dos'); motionArtChanged(); vi.setSystemTime(Date.now() + 6000)
    await completeNextMotionArt()
    expect(find.mock.calls.map(call => call[0].album)).toEqual(['Uno', 'Roto', 'Roto', 'Dos'])
  })

  it('automatically reviews legacy negatives and wakes unmatched and verified deadlines', async () => {
    addTrack('Pendiente')
    const [key] = pinnedMotion().keys(), dir = join(root, 'motion-cache', key!)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'metadata.json'), JSON.stringify({ version: 1, status: 'none', checkedAt: Date.now(), accessed: Date.now() }))
    let matched = false
    const find = vi.fn(async (): Promise<MotionLookup> => matched ? { status: 'none', albumIds: [9] } : { status: 'unmatched' })
    setMotionCache(new MotionCache(join(root, 'motion-cache'), join(root, 'staging'), () => new Set(pinnedMotion().keys()), { find, download: vi.fn() }))
    await completeNextMotionArt()
    expect(find).toHaveBeenCalledTimes(1)
    expect(motionArtDelay()).toBe(86_400_000)
    vi.setSystemTime(Date.now() + 86_400_000); matched = true
    await completeNextMotionArt()
    expect(find).toHaveBeenCalledTimes(2)
    expect(motionArtDelay()).toBe(30 * 86_400_000)
    vi.setSystemTime(Date.now() + 30 * 86_400_000)
    await completeNextMotionArt()
    expect(find).toHaveBeenCalledTimes(3)
  })
})
