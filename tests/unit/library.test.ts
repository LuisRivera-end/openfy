import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { statSync } from 'node:fs'
import { mkdtemp, copyFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { dataPaths, getDatabase, closeDatabase } from '../../server/database'
import { assets, imports, playlists, tracks, youtubeAudio, youtubeSongs } from '../../server/database/schema'
import { importFile } from '../../server/utils/importer'
import { convertTrack, setPlaybackActivity, resumeConversions } from '../../server/utils/workers'
import { readLibrary, readLibraryAsync } from '../../server/utils/library'
import { generateAudio } from '../helpers/audio'
import sharp from 'sharp'
import { scanTrackGenres } from '../../server/utils/genres'
import { ingestListening, recentlyPlayed } from '../../server/utils/telemetry'
import { listeningDay } from '../../shared/utils/telemetry'

vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, statSync: vi.fn(fs.statSync) }
})

let root: string
async function importFixture(source: string, filename: string) {
  const id = randomUUID()
  const stagingPath = join(dataPaths().staging, id + filename)
  await copyFile(source, stagingPath)
  getDatabase().insert(imports).values({ id, filename, stagingPath, state: 'processing', createdAt: Date.now() }).run()
  await importFile(id)
  return getDatabase().select().from(imports).where(eq(imports.id, id)).get()!
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'openfy-unit-'))
  process.env.OPENFY_DATA_DIR = join(root, 'data')
})
afterAll(async () => { closeDatabase(); delete process.env.OPENFY_DATA_DIR; await rm(root, { recursive: true, force: true }) })

describe('local library and conversion', () => {
  it('imports genres and backfills old metadata without changing favorites or identifiers', async () => {
    const path = join(root, 'Con genero.mp3')
    generateAudio(path, { tags: true, genre: 'Alternative', frequency: 613 })
    const job = await importFixture(path, 'Con genero.mp3')
    const db = getDatabase()
    const row = db.select().from(tracks).where(eq(tracks.id, job.trackId!)).get()!
    expect(row.metadata.genres).toEqual(['Alternative'])
    db.update(tracks).set({ favorite: true, genresScanned: false, metadata: { ...row.metadata, genres: undefined } }).where(eq(tracks.id, row.id)).run()
    await scanTrackGenres(row.id)
    const updated = db.select().from(tracks).where(eq(tracks.id, row.id)).get()!
    expect(updated.metadata.genres).toEqual(['Alternative']); expect(updated.favorite).toBe(true); expect(updated.id).toBe(row.id); expect(updated.genresScanned).toBe(true)
  })
  it('imports untagged audio with filename fallback and stable asset checksum', async () => {
    const path = join(root, 'Sin etiquetas.mp3')
    generateAudio(path)
    const job = await importFixture(path, 'Sin etiquetas.mp3')
    expect(job.state).toBe('complete')
    const track = readLibrary().tracks.find(t => t.id === job.trackId)!
    expect(track.title).toBe('Sin etiquetas')
    expect(track.artist).toBe('Artista desconocido')
    expect(track.original.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(track.mobile?.id).toBe(track.original.id)
    expect(track.duration).toBeGreaterThan(0)
    expect(track.artwork).toBeNull()
  })
  it('deduplicates identical bytes even under a different filename', async () => {
    const before = readLibrary().tracks.length
    const job = await importFixture(join(root, 'Sin etiquetas.mp3'), 'Duplicada.mp3')
    expect(job.state).toBe('duplicate')
    expect(readLibrary().tracks).toHaveLength(before)
    await expect(access(job.stagingPath)).rejects.toThrow()
  })
  it('rejects corrupt audio without leaving a track or staged upload', async () => {
    const path = join(root, 'Corrupta.mp3')
    await writeFile(path, 'This is not audio')
    const before = readLibrary().tracks.length
    const job = await importFixture(path, 'Corrupta.mp3')
    expect(job.state).toBe('failed')
    expect(readLibrary().tracks).toHaveLength(before)
    await expect(access(job.stagingPath)).rejects.toThrow()
  })
  it('rejects misleading extensions without creating an unplayable asset', async () => {
    const source = join(root, 'Falso.mp3')
    generateAudio(source, { frequency: 295 })
    const job = await importFixture(source, 'Falso.flac')
    expect(job.state).toBe('failed')
    expect(job.error).toBeTruthy()
  })
  it('extracts an embedded cover and a palette from the real image', async () => {
    const cover = join(root, 'cover.png')
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#e66c38' } }).png().toFile(cover)
    const path = join(root, 'Con portada.mp3')
    generateAudio(path, { artwork: cover })
    const job = await importFixture(path, 'Con portada.mp3')
    const track = readLibrary().tracks.find(t => t.id === job.trackId)!
    expect(job.state).toBe('complete')
    expect(track.artwork).toMatch(/^\/api\/artwork\/[a-f0-9]{64}\.webp$/)
    expect(track.palette).toHaveLength(3)
    expect(track.palette[0]).toMatch(/^#e[0-9a-f]6[0-9a-f]3[0-9a-f]$/)
    await expect(access(join(dataPaths().artwork, track.artwork!.split('/').pop()!))).resolves.toBeUndefined()
  })
  it('preserves FLAC originals and converts to a separate AAC asset', async () => {
    const path = join(root, 'Horizonte.flac')
    generateAudio(path, { format: 'flac', tags: true })
    const job = await importFixture(path, 'Horizonte.flac')
    expect(job.state).toBe('complete')
    await convertTrack(job.trackId!)
    const track = readLibrary().tracks.find(t => t.id === job.trackId)!
    expect(track.title).toBe('Horizonte')
    expect(track.conversion).toBe('ready')
    expect(track.original.mime).toBe('audio/flac')
    expect(track.mobile?.mime).toBe('audio/mp4')
    expect(track.mobile?.id).not.toBe(track.original.id)
  })
  it('reports conversion failure and permits retry after FFmpeg becomes available', async () => {
    const path = join(root, 'Otra.flac')
    generateAudio(path, { format: 'flac', frequency: 330 })
    const job = await importFixture(path, 'Otra.flac')
    process.env.OPENFY_FFMPEG = join(root, 'missing-ffmpeg.exe')
    await convertTrack(job.trackId!)
    expect(readLibrary().tracks.find(t => t.id === job.trackId)?.conversion).toBe('failed')
    delete process.env.OPENFY_FFMPEG
    await convertTrack(job.trackId!)
    expect(readLibrary().tracks.find(t => t.id === job.trackId)?.conversion).toBe('ready')
  })
  it('keeps conversions pending while a client is playing', async () => {
    const track = readLibrary().tracks.find(t => t.format === 'FLAC')!
    getDatabase().update(tracks).set({ conversion: 'pending' }).where(eq(tracks.id, track.id)).run()
    setPlaybackActivity('test', true)
    await convertTrack(track.id)
    expect(readLibrary().tracks.find(t => t.id === track.id)?.conversion).toBe('pending')
    resumeConversions()
  })
})

it('verifies only recent audio, once per asset, and rechecks disk changes on the next read', async () => {
  const db = getDatabase(), { originals } = dataPaths()
  const localFavorites = readLibrary().tracks.filter(track => track.favorite).length
  const shared = { id: randomUUID(), filename: 'shared.m4a', bytes: 3, mime: 'audio/mp4', hash: 'shared', variant: 'original' as const }
  const unrelated = { ...shared, id: randomUUID(), filename: 'unrelated.m4a', hash: 'unrelated' }
  const sharedPath = join(originals, shared.filename), unrelatedPath = join(originals, unrelated.filename)
  await writeFile(sharedPath, 'abc'); await writeFile(unrelatedPath, 'abc')
  db.insert(assets).values([shared, unrelated]).run()
  const songs = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map(videoId => ({ videoId, title: 'Horizonte', artists: ['Openfy'], album: null, artwork: 'catalog.jpg', duration: 100 }))
  const startedAt = Date.parse('2026-11-12T07:00:00Z'), deviceId = randomUUID()
  db.insert(youtubeSongs).values(songs.map((song, i) => ({ videoId: song.videoId, song, favorite: i === 2, addedAt: startedAt }))).run()
  db.insert(youtubeAudio).values(songs.map((song, i) => ({ videoId: song.videoId, assetId: i === 2 ? unrelated.id : shared.id,
    duration: 101, artwork: `download-${i}.jpg`, palette: ['#000000'], downloadedAt: startedAt }))).run()
  const playlist = { id: randomUUID(), name: 'Para correr', trackIds: [`youtube:${songs[1]!.videoId}`, `youtube:${songs[0]!.videoId}`], revision: 1, updatedAt: startedAt }
  db.insert(playlists).values(playlist).run()
  ingestListening(songs.map((song, i) => ({ id: randomUUID(), deviceId, sequence: 1, entry: { source: 'youtube', song },
    startedAt, updatedAt: startedAt + 1000 + i, durationMs: 100000, listenedMs: 1000, days: { [listeningDay(startedAt)]: 1000 }, qualifiedAt: null,
    context: i === 1 ? { kind: 'playlist', id: playlist.id } : i === 2 ? { kind: 'favorites' } : { kind: 'song' } })))

  await expect(readLibraryAsync()).resolves.toEqual(readLibrary())
  const checkedPaths = () => vi.mocked(statSync).mock.calls.map(([path]) => path).filter(path => path === sharedPath || path === unrelatedPath)
  vi.mocked(statSync).mockClear()
  const result = recentlyPlayed()
  expect(result.items).toMatchObject([
    { key: 'favorites', subtitle: `${localFavorites + 1} canciones` },
    { key: `playlist:${playlist.id}`, artwork: 'download-1.jpg' },
    { key: `song:youtube:${songs[0]!.videoId}`, artwork: 'download-0.jpg', item: { artwork: 'download-0.jpg', duration: 101, palette: ['#000000'], format: 'AAC' } },
  ])
  expect(checkedPaths()).toEqual([sharedPath])

  await writeFile(sharedPath, 'a')
  vi.mocked(statSync).mockClear()
  expect(recentlyPlayed().items.slice(1)).toMatchObject([
    { artwork: 'catalog.jpg' }, { artwork: 'catalog.jpg', item: { duration: 100, format: 'YouTube Music' } },
  ])
  expect(checkedPaths()).toEqual([sharedPath])

  await rm(sharedPath)
  expect(recentlyPlayed().items[2]?.item?.format).toBe('YouTube Music')
  await writeFile(sharedPath, 'abc')
  expect(recentlyPlayed()).toEqual(result)
})
