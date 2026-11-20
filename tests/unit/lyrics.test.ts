import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { LyricsContentType, TimestampFormat } from 'music-metadata'
import { activeLyricsTime, activeLyricsWord, lyricsSignature, parseLrc, sameLyricsSignature } from '../../shared/utils/lyrics'
import type { LyricsLine } from '../../shared/types/lyrics'
import contract from '../fixtures/lyrics-contract.json'
import { embeddedLyrics } from '../../server/utils/embedded-lyrics'
import { LrcClient, LyricsProviderError, matchesLyrics, type LrcRecord, type ProviderLyrics } from '../../server/utils/lrclib'
import { resolveLyrics } from '../../server/utils/lyrics'
import { closeDatabase, dataPaths, getDatabase } from '../../server/database'
import { imports, lyrics, tracks } from '../../server/database/schema'
import { importFile } from '../../server/utils/importer'
import { readLibrary } from '../../server/utils/library'
import { generateAudio } from '../helpers/audio'
import type { LyricsSignature } from '../../shared/types/lyrics'
import type { PlaybackEntry } from '../../shared/types/music'

const signature: LyricsSignature = { title: 'Horizonte', artists: ['Openfy'], album: 'Pruebas de audio', duration: 35 }
const record: LrcRecord = { id: 7, trackName: 'Horizonte', artistName: 'Openfy', albumName: 'Pruebas de audio', duration: 35,
  instrumental: false, plainLyrics: 'Primera línea\nSegunda línea', syncedLyrics: '[00:01.00]Primera línea\n[00:10.00]Segunda línea' }
const provider: ProviderLyrics = { ...parseLrc(record.syncedLyrics!), instrumental: false, source: 'lrclib', attribution: 'Letras de LRCLIB', sourceUrl: 'https://lrclib.net/api/get/7' }
const youtubeEntry: PlaybackEntry = { source: 'youtube', song: { videoId: 'abcdefghijk', title: 'Horizonte', artists: ['Openfy'], album: 'Pruebas de audio', duration: 35, artwork: null } }
let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'openfy-lyrics-'))
  process.env.OPENFY_DATA_DIR = join(root, 'data')
})
afterAll(async () => {
  closeDatabase(); delete process.env.OPENFY_DATA_DIR
  expect(resolve(root).startsWith(resolve(tmpdir()) + sep)).toBe(true)
  await rm(root, { recursive: true, force: true })
})

describe('lyrics timeline', () => {
  it('handles BOM, CRLF, metadata, offsets, multiple timestamps and fractions', () => {
    const parsed = parseLrc('\uFEFF[ar:Openfy]\r\n[offset:-500]\r\n[00:02.5][00:05.250]Verso\r\n[00:03]Otro\r\n[00:04.00]\r\n[00:99.00]Inválido')
    expect(parsed.lines).toEqual([{ time: 2, text: 'Verso' }, { time: 2.5, text: 'Otro' }, { time: 3.5, text: '' }, { time: 4.75, text: 'Verso' }])
    expect(parsed.plainText).not.toContain('[ar:')
    expect(parseLrc('[offset:+250]\n[00:00.00]Inicio').lines[0]?.time).toBe(.25)
    expect(parseLrc('[offset:-500]\n[00:00.00]Inicio').lines[0]?.time).toBe(0)
  })
  it('tracks silence, exact boundaries, seeks backwards and simultaneous lines', () => {
    const lines = parseLrc('[00:01]A\n[00:02]B\n[00:02]C\n[00:03]\n[00:10]D').lines
    expect(activeLyricsTime(lines, 0)).toBeNull()
    expect(activeLyricsTime(lines, 2)).toBe(2)
    expect(activeLyricsTime(lines, 6)).toBe(3)
    expect(activeLyricsTime(lines, 1.5)).toBe(1)
    expect(activeLyricsTime([], 20)).toBeNull()
  })
  it('keeps recording versions and rejects incompatible measured durations', () => {
    expect(sameLyricsSignature(signature, { ...signature, duration: 36 })).toBe(true)
    expect(sameLyricsSignature(signature, { ...signature, duration: 40 })).toBe(false)
    expect(sameLyricsSignature(signature, { ...signature, title: 'Horizonte (Live)' })).toBe(false)
    expect(sameLyricsSignature({ ...signature, duration: null }, signature)).toBe(false)
    expect(lyricsSignature(youtubeEntry, undefined, 33).duration).toBe(33)
    expect(matchesLyrics(record, { ...signature, title: 'Horizonte (Remix)' })).toBe(false)
    expect(matchesLyrics({ ...record, artistName: 'Otro' }, signature)).toBe(false)
    expect(matchesLyrics({ ...record, duration: 40 }, signature)).toBe(false)
    expect(matchesLyrics({ ...record, artistName: 'Openfy & Invitado' }, signature)).toBe(true)
  })
  it('reads embedded plain text, LRC and millisecond SYLT, without treating MPEG frames as milliseconds', () => {
    const tag = { contentType: LyricsContentType.lyrics, timeStampFormat: TimestampFormat.notSynchronized, text: 'Letra original', syncText: [] }
    expect(embeddedLyrics([tag])).toEqual({ plainText: 'Letra original', lines: [], format: 2 })
    expect(embeddedLyrics([tag, { ...tag, text: '[00:01.00]Sincronizada' }])?.lines).toEqual([{ time: 1, text: 'Sincronizada' }])
    expect(embeddedLyrics([{ ...tag, text: undefined, timeStampFormat: TimestampFormat.milliseconds, syncText: [{ timestamp: 1500, text: 'SYLT' }] }])?.lines[0]?.time).toBe(1.5)
    expect(embeddedLyrics([{ ...tag, text: undefined, timeStampFormat: TimestampFormat.mpegFrameNumber, syncText: [{ timestamp: 1500, text: 'SYLT' }] }])).toEqual({ plainText: 'SYLT', lines: [], format: 2 })
  })
})

describe('LRCLIB client', () => {
  const immediate = async () => {}
  it('requests exact metadata, identifies Openfy and normalizes synced records', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(record))
    const result = await new LrcClient(fetcher, Date.now, immediate).get(signature)
    const url = new URL(String(fetcher.mock.calls[0]![0]))
    expect(url.origin).toBe('https://lrclib.net')
    expect(url.searchParams.get('duration')).toBe('35')
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ 'User-Agent': expect.stringContaining('Openfy') })
    expect(result?.lines).toHaveLength(2)
  })
  it('distinguishes missing, instrumental, plain and mismatched recordings', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ ...record, instrumental: true, syncedLyrics: null, plainLyrics: null }))
      .mockResolvedValueOnce(Response.json({ ...record, syncedLyrics: null }))
      .mockResolvedValueOnce(Response.json({ ...record, duration: 99 }))
    const client = new LrcClient(fetcher, Date.now, immediate)
    expect(await client.get(signature)).toBeNull()
    expect((await client.get(signature))?.instrumental).toBe(true)
    expect((await client.get(signature))?.lines).toEqual([])
    expect(await client.get(signature)).toBeNull()
  })
  it('serializes requests and honors provider cooldowns before making more requests', async () => {
    let now = 100000, simultaneous = 0, peak = 0
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      peak = Math.max(peak, ++simultaneous)
      await Promise.resolve(); simultaneous--
      return Response.json(record)
    })
    const delays: number[] = []
    const client = new LrcClient(fetcher, () => now, async ms => { delays.push(ms); now += ms })
    await Promise.all([client.get(signature), client.get(signature)])
    expect(peak).toBe(1); expect(delays).toContain(300)
    fetcher.mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'Retry-After': '10' } }))
    await expect(client.get(signature)).rejects.toMatchObject({ retryAfter: expect.any(Number) })
    const calls = fetcher.mock.calls.length
    await expect(client.get(signature)).rejects.toBeInstanceOf(LyricsProviderError)
    expect(fetcher).toHaveBeenCalledTimes(calls)
    now += 14000
    expect(await client.get(signature)).not.toBeNull()
  })
  it('treats timeouts, invalid JSON and malformed records as retryable errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new DOMException('Timeout', 'TimeoutError'))
      .mockResolvedValueOnce(new Response('not json')).mockResolvedValueOnce(Response.json({ id: 1 }))
    const client = new LrcClient(fetcher, Date.now, immediate)
    for (let index = 0; index < 3; index++) await expect(client.get(signature)).rejects.toBeInstanceOf(LyricsProviderError)
  })
})

async function importLyrics(text?: string) {
  const id = randomUUID(), path = join(root, `${id}.m4a`), stagingPath = join(dataPaths().staging, `${id}.m4a`)
  generateAudio(path, { format: 'aac', tags: true, lyrics: text, duration: 35, frequency: 220 + Math.random() * 100 })
  await copyFile(path, stagingPath)
  getDatabase().insert(imports).values({ id, filename: `${id}.m4a`, stagingPath, state: 'processing', createdAt: Date.now() }).run()
  await importFile(id)
  const job = getDatabase().select().from(imports).where(eq(imports.id, id)).get()!
  expect(job.state).toBe('complete')
  return { source: 'local' as const, trackId: job.trackId! }
}

describe('persistent lyrics resolution', () => {
  it('does not let a delayed earlier signature replace a corrected-duration result', async () => {
    let finish!: (value: ProviderLyrics) => void
    const entry = { ...youtubeEntry, song: { ...youtubeEntry.song!, videoId: 'oldnewlyric' + '0' } } as PlaybackEntry
    const older = resolveLyrics({ entry, duration: 30, refresh: true }, { lrc: () => new Promise(resolve => { finish = resolve }) })
    await resolveLyrics({ entry, duration: 60, refresh: true }, { lrc: async () => provider })
    finish(provider)
    await older
    expect(getDatabase().select().from(lyrics).where(eq(lyrics.key, 'youtube:oldnewlyric0')).get()?.result.signature.duration).toBe(60)
  })
  it('extracts embedded lyrics on import and prioritizes embedded synchronization', async () => {
    const entry = await importLyrics('[00:01.00]Verso incluido\n[00:10.00]Otro verso')
    const lrc = vi.fn().mockResolvedValue(provider)
    const result = await resolveLyrics({ entry }, { lrc })
    expect(result.source).toBe('embedded'); expect(result.status).toBe('synced'); expect(lrc).not.toHaveBeenCalled()
    expect(readLibrary().tracks.find(track => track.id === entry.trackId)).not.toHaveProperty('embeddedLyrics')
  })
  it('reads previously imported files lazily without reimporting', async () => {
    const entry = await importLyrics('Letra anterior')
    getDatabase().update(tracks).set({ embeddedLyrics: null, lyricsScanned: false }).where(eq(tracks.id, entry.trackId)).run()
    const result = await resolveLyrics({ entry }, { lrc: async () => null })
    expect(result.plainText).toBe('Letra anterior')
    expect(getDatabase().select().from(tracks).where(eq(tracks.id, entry.trackId)).get()?.lyricsScanned).toBe(true)
  })
  it('prefers synced LRCLIB over embedded plain and embedded plain over provider plain', async () => {
    const entry = await importLyrics('Texto incluido')
    expect((await resolveLyrics({ entry }, { lrc: async () => provider })).source).toBe('lrclib')
    const result = await resolveLyrics({ entry, refresh: true }, { lrc: async () => ({ ...provider, lines: [] }) })
    expect(result.source).toBe('embedded'); expect(result.plainText).toBe('Texto incluido')
  })
  it('caches positive results for 30 days and invalidates a changed duration', async () => {
    const lrc = vi.fn().mockResolvedValue(provider), now = Date.now()
    const first = await resolveLyrics({ entry: youtubeEntry, refresh: true }, { lrc, now: () => now })
    expect(first.expiresAt - now).toBe(30 * 86400000)
    await resolveLyrics({ entry: youtubeEntry }, { lrc, now: () => now + 1000 })
    expect(lrc).toHaveBeenCalledTimes(1)
    await resolveLyrics({ entry: youtubeEntry, duration: 42 }, { lrc })
    expect(lrc).toHaveBeenCalledTimes(2)
    await resolveLyrics({ entry: youtubeEntry, duration: 42 }, { lrc, now: () => now + 31 * 86400000 })
    expect(lrc).toHaveBeenCalledTimes(3)
  })
  it('uses YouTube text as fallback, keeps attribution and identifies instrumental records', async () => {
    const youtube = vi.fn().mockResolvedValue({ ...provider, lines: [], source: 'youtube', attribution: 'Créditos del proveedor' })
    const text = await resolveLyrics({ entry: youtubeEntry, refresh: true }, { lrc: async () => null, youtube })
    expect(text.status).toBe('plain'); expect(text.source).toBe('youtube'); expect(text.attribution).toBe('Créditos del proveedor')
    youtube.mockClear()
    const instrumental = await resolveLyrics({ entry: youtubeEntry, refresh: true }, {
      lrc: async () => ({ ...provider, plainText: '', lines: [], instrumental: true }), youtube,
    })
    expect(instrumental.status).toBe('instrumental'); expect(youtube).not.toHaveBeenCalled()
  })
  it('caches genuine absence for 24 hours and never caches transient failures as absence', async () => {
    const entry = await importLyrics(), now = Date.now()
    const missing = await resolveLyrics({ entry }, { lrc: async () => null, now: () => now })
    expect(missing.status).toBe('not_found'); expect(missing.expiresAt - now).toBe(86400000)
    const lrc = vi.fn().mockRejectedValue(new LyricsProviderError())
    await expect(resolveLyrics({ entry, refresh: true }, { lrc })).rejects.toBeInstanceOf(LyricsProviderError)
    expect(getDatabase().select().from(lyrics).where(eq(lyrics.key, entry.trackId)).get()?.result.fetchedAt).toBe(now)
  })
  it('serves useful fallback during outages without hiding the outage in a fresh cache', async () => {
    const entry = await importLyrics('Texto propio'), now = Date.now()
    const result = await resolveLyrics({ entry }, { lrc: async () => { throw new LyricsProviderError() }, now: () => now })
    expect(result.status).toBe('plain'); expect(result.expiresAt).toBe(now)
    expect(getDatabase().select().from(lyrics).where(eq(lyrics.key, entry.trackId)).get()).toBeUndefined()
  })
  it('cleans up latestSignatures after resolution finishes or fails', async () => {
    const entry = await importLyrics('Texto propio')
    const { latestSignatures } = await import('../../server/utils/lyrics')
    expect(latestSignatures.size).toBe(0)
    await resolveLyrics({ entry }, { lrc: async () => null })
    expect(latestSignatures.size).toBe(0)

    const empty = await importLyrics('')
    await expect(resolveLyrics({ entry: empty, refresh: true }, { lrc: async () => { throw new LyricsProviderError() } })).rejects.toBeInstanceOf(LyricsProviderError)
    expect(latestSignatures.size).toBe(0)
  })
  it('migrates a v1 database in place and can reopen it repeatedly', () => {
    const before = readLibrary().tracks.map(track => track.id)
    const filename = join(dataPaths().root, 'openfy.sqlite')
    closeDatabase()
    const previous = new Database(filename)
    previous.exec('DROP TABLE lyrics; ALTER TABLE tracks DROP COLUMN embedded_lyrics; ALTER TABLE tracks DROP COLUMN lyrics_scanned; PRAGMA user_version = 1;')
    previous.close()
    expect(readLibrary().tracks.map(track => track.id)).toEqual(before)
    expect(getDatabase().select().from(lyrics).all()).toEqual([])
    closeDatabase()
    expect(readLibrary().tracks.map(track => track.id)).toEqual(before)
    closeDatabase()
    const migrated = new Database(filename)
    expect(migrated.pragma('user_version', { simple: true })).toBe(6)
    migrated.close()
  })
})

describe('shared per-word lyrics contract', () => {
  it('parses enhanced LRC word stamps without showing them', () => {
    for (const example of contract.parse) expect(parseLrc(example.lrc).lines, example.name).toEqual(example.lines)
  })
  it('finds the word being sung and its progress', () => {
    for (const example of contract.active) {
      const line = contract.lines[example.line as keyof typeof contract.lines] as LyricsLine
      const value = activeLyricsWord(line, example.next, example.position)
      if (example.expected === null) expect(value).toBeNull()
      else { expect(value?.index).toBe(example.expected.index); expect(value?.progress).toBeCloseTo(example.expected.progress, 6) }
    }
  })
  it('groups word-level SYLT fragments into timed lines', () => {
    const syncText = [{ timestamp: 1000, text: 'Hola ' }, { timestamp: 1500, text: 'mundo\n' }, { timestamp: 3000, text: 'Otra ' }, { timestamp: 3500, text: 'vez' }]
    const content = embeddedLyrics([{ descriptor: '', language: 'spa', contentType: 1, timeStampFormat: TimestampFormat.milliseconds, syncText } as never])
    expect(content?.lines).toEqual([
      { time: 1, text: 'Hola mundo', words: [{ time: 1, text: 'Hola ' }, { time: 1.5, text: 'mundo' }] },
      { time: 3, text: 'Otra vez', words: [{ time: 3, text: 'Otra ' }, { time: 3.5, text: 'vez' }] }])
    expect(content?.plainText).toBe('Hola mundo\nOtra vez')
  })
})

describe('enhanced LRC read through music-metadata', () => {
  it('keeps word stamps that arrive inside millisecond entries', () => {
    const syncText = [{ timestamp: 500, text: '<00:00.50>El <00:00.90>corazón<00:01.60>' }, { timestamp: 2000, text: 'Sin palabras' }]
    const content = embeddedLyrics([{ contentType: LyricsContentType.lyrics, timeStampFormat: TimestampFormat.milliseconds, text: 'x', syncText }])
    expect(content?.lines).toEqual([
      { time: .5, text: 'El corazón', words: [{ time: .5, text: 'El ' }, { time: .9, text: 'corazón' }], end: 1.6 },
      { time: 2, text: 'Sin palabras' }])
  })
})
