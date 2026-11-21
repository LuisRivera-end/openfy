import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { closeDatabase, getDatabase } from '../../server/database'
import { tracks } from '../../server/database/schema'
import { MotionProviderError, type MotionProvider } from '../../server/utils/apple-motion'
import { MotionCache, setMotionCache } from '../../server/utils/motion-art'

const getYouTubeAlbum = vi.hoisted(() => vi.fn())
vi.mock('../../server/utils/youtube-catalog', () => ({ getYouTubeAlbum }))

type Handler = typeof import('../../server/api/albums/presentation.post')['default']
let handler: Handler, root: string
const setHeader = vi.fn()
const find = vi.fn<MotionProvider['find']>()
const download = vi.fn<MotionProvider['download']>(async (_master, destination) => {
  await writeFile(destination, 'test video')
  return { width: 320, height: 320 }
})

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (callback: Handler) => callback)
  vi.stubGlobal('readBody', (event: { body: unknown }) => event.body)
  vi.stubGlobal('setHeader', setHeader)
  vi.stubGlobal('createError', (error: { statusCode: number; message: string }) => Object.assign(new Error(error.message), error))
  handler = (await import('../../server/api/albums/presentation.post')).default
})
afterAll(() => { vi.unstubAllGlobals() })

beforeEach(async () => {
  vi.resetAllMocks()
  root = await mkdtemp(join(tmpdir(), 'openfy-album-presentation-'))
  vi.stubEnv('OPENFY_DATA_DIR', root)
  vi.stubEnv('OPENFY_MOTION_ART', 'on')
  setMotionCache(new MotionCache(join(root, 'motion-cache'), join(root, 'staging'), () => new Set(), { find, download }, copyFile))
  find.mockResolvedValue({ status: 'unmatched' })
})
afterEach(async () => {
  setMotionCache(undefined)
  closeDatabase()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

const youtube = { source: 'youtube', albumId: 'MPREb_data', album: ' DATA ', artists: [' Tainy '] }
const post = (body: unknown) => handler({ body } as Parameters<Handler>[0])
const colors = { background: '#590019', text1: null, text2: null, text3: null, text4: null }

describe('album presentation endpoint', () => {
  it.each([
    { source: 'local', trackId: 'bad-uuid' }, { ...youtube, motion: 'yes' }, { ...youtube, artists: [] },
    { ...youtube, artists: Array(21).fill('Tainy') }, { ...youtube, artists: ['x'.repeat(501)] }, { ...youtube, album: ' ' },
    { ...youtube, albumId: 123 },
  ])('rejects invalid request %#', async body => {
    await expect(post(body)).rejects.toMatchObject({ statusCode: 400 })
    expect(find).not.toHaveBeenCalled()
  })

  it('prefers Apple notes and downloads only when motion is requested', async () => {
    find.mockResolvedValue({ status: 'ready', source: { albumId: 12, master: 'https://mvod.itunes.apple.com/master.m3u8' }, editorial: 'Apple notes', colors })
    const base = { description: { text: 'Apple notes', source: 'apple' }, colors }
    expect(await post(youtube)).toEqual({ ...base, motion: { status: 'none' } })
    expect(download).not.toHaveBeenCalled()
    expect(await post({ ...youtube, motion: true })).toEqual({ ...base, motion: {
      status: 'ready', url: expect.stringMatching(/^\/api\/motion\/[a-f0-9]{64}\.mp4$/), width: 320, height: 320,
    } })
    expect(find).toHaveBeenLastCalledWith({ album: 'DATA', artists: ['Tainy'] }, 12)
    expect(download).toHaveBeenCalledOnce()
    expect(getYouTubeAlbum).not.toHaveBeenCalled()
  })

  it('uses the local album artist and returns the static marker for a missing track', async () => {
    const trackId = randomUUID()
    getDatabase().insert(tracks).values({ id: trackId, hash: trackId, originalId: randomUUID(), conversion: 'ready', metadata: {
      id: trackId, title: 'Canción', artist: 'Track artist', albumArtist: 'Album artist', album: 'Disco', albumId: trackId,
      duration: 1, trackNumber: 1, disc: 1, year: null, format: 'FLAC', artwork: null, palette: [], addedAt: 1,
    } }).run()
    await post({ source: 'local', trackId })
    expect(find).toHaveBeenCalledWith({ album: 'Disco', artists: ['Album artist', 'Track artist'] }, undefined)
    expect(await post({ source: 'local', trackId: randomUUID(), motion: true })).toEqual({ motion: { status: 'none' } })
    expect(getYouTubeAlbum).not.toHaveBeenCalled()
  })

  it('falls back to a valid MPRE detail and keeps available Apple colors', async () => {
    find.mockResolvedValue({ status: 'none', albumIds: [12], colors })
    getYouTubeAlbum.mockResolvedValue({ description: 'YouTube notes' })
    expect(await post(youtube)).toEqual({ motion: { status: 'none' }, colors, description: { text: 'YouTube notes', source: 'youtube' } })
    expect(getYouTubeAlbum).toHaveBeenCalledExactlyOnceWith('MPREb_data')
    for (const albumId of ['MPRb_data', 'MPRE', 'MPRE/invalid', undefined]) {
      expect(await post({ ...youtube, albumId })).toEqual({ motion: { status: 'none' }, colors })
    }
    expect(getYouTubeAlbum).toHaveBeenCalledOnce()
  })

  it('returns a partial response and provider retry delay when Apple fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    find.mockRejectedValue(new MotionProviderError('unavailable', 1_201_000))
    getYouTubeAlbum.mockResolvedValue({ description: 'YouTube notes' })
    expect(await post({ ...youtube, motion: true })).toEqual({ motion: { status: 'none', retryAfterMs: expect.any(Number) },
      description: { text: 'YouTube notes', source: 'youtube' } })
    expect(setHeader).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 1201)
  })

  it('keeps Apple colors and returns a retry delay when YouTube fails', async () => {
    find.mockResolvedValue({ status: 'none', albumIds: [12], colors })
    getYouTubeAlbum.mockRejectedValue(new Error('unavailable'))
    expect(await post(youtube)).toEqual({ motion: { status: 'none' }, colors })
    expect(setHeader).toHaveBeenCalledWith(expect.anything(), 'Retry-After', 900)
  })
})
