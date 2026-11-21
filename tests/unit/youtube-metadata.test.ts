import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase } from '../../server/database'
import { readLibrary } from '../../server/utils/library'
import { mergeSavedSong, saveYouTubeSong } from '../../server/utils/saved-music'
import { ITunesGenres, completeNextYouTubeSong, metadataKey, setMetadataProvider, youtubeMetadataDelay } from '../../server/utils/youtube-metadata'
import type { YouTubeSong } from '../../shared/types/music'

const provider = vi.hoisted(() => ({ getUpNext: vi.fn() }))
vi.mock('../../server/utils/youtube-music', () => ({ youtubeSession: async () => ({ music: provider }) }))

type Result = Record<string, unknown>
const json = (results: Result[]) => new Response(JSON.stringify({ resultCount: results.length, results }), { headers: { 'Content-Type': 'application/json' } })
const track = (trackName: string, artistName: string, primaryGenreName: string): Result => ({ wrapperType: 'track', kind: 'song', trackName, artistName, primaryGenreName })
/** Routes iTunes requests by entity so each test states only what the catalog contains. */
function itunes(catalog: { songs?: Result[]; artists?: Result[]; albums?: Result[] }) {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input))
    expect(url.hostname).toBe('itunes.apple.com')
    expect(url.searchParams.get('country')).toBe('mx')
    const entity = url.searchParams.get('entity')
    return json(entity === 'song' ? catalog.songs || [] : entity === 'musicArtist' ? catalog.artists || [] : catalog.albums || [])
  })
}
const song = (values: Partial<YouTubeSong> = {}): YouTubeSong => ({ videoId: 'abcdefghijk', title: 'DtMF', artists: ['Bad Bunny'], album: null, artwork: null, duration: 237, ...values })

let root: string
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'openfy-metadata-')); process.env.OPENFY_DATA_DIR = root })
afterAll(async () => { closeDatabase(); delete process.env.OPENFY_DATA_DIR; await rm(root, { recursive: true, force: true }) })
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'warn').mockImplementation(() => {}) })

describe('genre lookup', () => {
  it('normalizes accents, case, punctuation and featured credits, but keeps remixes apart', () => {
    expect(metadataKey('BAILE INoLVIDABLE')).toBe(metadataKey('Baile inolvidable'))
    expect(metadataKey('Después de la Playa')).toBe(metadataKey('Despues de la playa'))
    expect(metadataKey('MÍA (feat. Drake)')).toBe(metadataKey('MIA'))
    expect(metadataKey('un x100to - Single')).toBe(metadataKey('un x100to'))
    expect(metadataKey('No Me Conoce (Remix)')).not.toBe(metadataKey('No Me Conoce'))
  })

  it('takes the genre of the same recording by one of its artists, ignoring covers', async () => {
    const fetcher = itunes({ songs: [track('Ojitos Lindos', 'KIDZ BOP Kids', 'Música para niños'), track('Ojitos Lindos', 'Bad Bunny & Bomba Estéreo', 'Música latina')] })
    expect(await new ITunesGenres(fetcher).genres(song({ title: 'Ojitos Lindos', artists: ['Bad Bunny', 'Bomba Estéreo'] }))).toEqual(['Música latina'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('falls back to the album, then to the main artist, and reuses artist answers', async () => {
    const fetcher = itunes({
      songs: [track('DtMF (piano version)', 'Lil Baby Grand', 'Urbano latino')],
      artists: [{ wrapperType: 'artist', artistId: 1126808565, artistName: 'Bad Bunny', primaryGenreName: 'Urbano latino' }],
      albums: [{ wrapperType: 'artist', artistId: 1126808565 }, { wrapperType: 'collection', collectionName: 'DeBÍ TiRAR MáS FOToS', primaryGenreName: 'Música latina' }],
    })
    const genres = new ITunesGenres(fetcher)
    expect(await genres.genres(song({ album: 'DeBÍ TiRAR MáS FOToS' }))).toEqual(['Música latina'])
    expect(await genres.genres(song({ title: 'Otra', album: 'Desconocido' }))).toEqual(['Urbano latino'])
    expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).searchParams.get('entity') !== 'song')).toHaveLength(2)
  })

  it('returns no genre instead of guessing when nothing matches', async () => {
    expect(await new ITunesGenres(itunes({ songs: [track('DtMF', 'D\'SH!T', 'Música latina')] })).genres(song())).toEqual([])
  })

  it('reports provider failures so the song is retried later', async () => {
    await expect(new ITunesGenres(vi.fn(async () => new Response('', { status: 403 }))).genres(song())).rejects.toThrow('iTunes HTTP 403')
  })

  it('bounds artist and album caches to 200 entries evicting oldest (LRU)', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input))
      const entity = url.searchParams.get('entity')
      if (entity === 'musicArtist') {
        const term = url.searchParams.get('term')!
        return json([{ wrapperType: 'artist', artistId: Number(term.replace(/\D/g, '')) || 1, artistName: term, primaryGenreName: 'Pop' }])
      }
      if (entity === 'album') {
        const id = Number(url.searchParams.get('id'))
        return json([{ wrapperType: 'collection', collectionName: `Album ${id}`, primaryGenreName: 'Rock' }])
      }
      return json([])
    })
    const genres = new ITunesGenres(fetcher)
    for (let i = 1; i <= 201; i++) {
      await genres.genres({ title: 'Song', artists: [`Artist ${i}`], album: `Album ${i}` })
    }
    const nonSongCalls = () => fetcher.mock.calls.filter(([url]) => new URL(String(url)).searchParams.get('entity') !== 'song').length
    const cachedCalls = nonSongCalls()
    expect(cachedCalls).toBe(402)
    await genres.genres({ title: 'Song', artists: ['Artist 201'], album: 'Album 201' })
    expect(nonSongCalls()).toBe(cachedCalls)
    await genres.genres({ title: 'Song', artists: ['Artist 1'], album: 'Album 1' })
    expect(nonSongCalls()).toBe(cachedCalls + 2)
  })
})

describe('saved song completion', () => {
  it('keeps resolved album and genres when a client saves the song again', () => {
    const known = song({ album: 'DeBÍ TiRAR MáS FOToS', albumId: 'MPREb_debi', genres: ['Música latina'] })
    expect(mergeSavedSong(song(), known)).toMatchObject({ album: 'DeBÍ TiRAR MáS FOToS', albumId: 'MPREb_debi', genres: ['Música latina'] })
    expect(mergeSavedSong(song({ album: 'Otro', genres: ['Pop'] }), known)).toMatchObject({ album: 'Otro', genres: ['Pop'] })
  })

  it('completes album and genre once, retries after a provider failure and then stays done', async () => {
    let now = 1_000_000
    const clock = () => now
    provider.getUpNext.mockResolvedValue({ contents: { filterType: () => [{ video_id: 'abcdefghijk', album: { id: 'MPREb_debi', name: 'DeBÍ TiRAR MáS FOToS' } }] } })
    saveYouTubeSong({ song: song(), favorite: true })
    expect(youtubeMetadataDelay(now)).toBe(0)

    setMetadataProvider(new ITunesGenres(vi.fn(async () => { throw new Error('offline') })))
    await completeNextYouTubeSong(clock)
    expect(readLibrary().youtubeSongs?.[0]?.song.genres).toBeUndefined()
    expect(youtubeMetadataDelay(now)).toBeGreaterThan(60000)

    setMetadataProvider(new ITunesGenres(itunes({ songs: [track('DtMF', 'Bad Bunny', 'Música latina')] })))
    now += 11 * 60000
    await completeNextYouTubeSong(clock)
    expect(readLibrary().youtubeSongs?.[0]).toMatchObject({ favorite: true, song: { album: 'DeBÍ TiRAR MáS FOToS', albumId: 'MPREb_debi', genres: ['Música latina'] } })
    expect(youtubeMetadataDelay(now)).toBeNull()

    // Favoriting again from a catalog row that lacks both must not erase them.
    saveYouTubeSong({ song: song(), favorite: true })
    expect(readLibrary().youtubeSongs?.[0]?.song).toMatchObject({ album: 'DeBÍ TiRAR MáS FOToS', genres: ['Música latina'] })
  })

  it('can be switched off for isolated runs', () => {
    saveYouTubeSong({ song: song({ videoId: '12345678901' }) })
    process.env.OPENFY_METADATA_LOOKUP = 'off'
    try { expect(youtubeMetadataDelay()).toBeNull() } finally { delete process.env.OPENFY_METADATA_LOOKUP }
  })
})
