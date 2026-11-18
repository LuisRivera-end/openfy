import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, copyFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { dataPaths, getDatabase, closeDatabase } from '../../server/database'
import { imports, tracks } from '../../server/database/schema'
import { importFile } from '../../server/utils/importer'
import { convertTrack, setPlaybackActivity, resumeConversions } from '../../server/utils/workers'
import { readLibrary } from '../../server/utils/library'
import { generateAudio } from '../helpers/audio'
import sharp from 'sharp'
import { scanTrackGenres } from '../../server/utils/genres'

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
