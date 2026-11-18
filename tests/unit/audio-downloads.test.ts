import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import { closeDatabase, dataPaths, getDatabase } from '../../server/database'
import { audioDownloads, lyrics, playlists, youtubeAudio } from '../../server/database/schema'
import { readLibrary, readLibraryAsync } from '../../server/utils/library'
import { saveYouTubeSong } from '../../server/utils/saved-music'
import { prepareArtwork } from '../../server/utils/artwork-cache'
import { resolveLyrics } from '../../server/utils/lyrics'
import { DownloadedLyricsBackfill } from '../../server/utils/downloaded-lyrics'
import { changeAudioDownload, processNextDownload, queueAudioDownloads, readAudioDownloads, reconcileOfflineCollections,
  removeYouTubeAudio, resetAudioDownloads, setOfflineCollection, storedYouTubeAudio, stopAudioDownloads, readAudioDownloadsAsync } from '../../server/utils/audio-downloads'
import { collectionMap } from '../../shared/utils/collections'
import { collectionProgress, downloadTarget } from '../../shared/utils/offline'
import { localArtwork } from '../../shared/utils/artwork'
import { generateAudio } from '../helpers/audio'
import type { YouTubeSong } from '../../shared/types/music'

let root: string, raw: Uint8Array
const song: YouTubeSong = { videoId: 'download001', title: 'Descarga de prueba', artists: ['Openfy'], album: 'Pruebas', duration: 2, artwork: null }
const response = (bytes = raw) => new Response(bytes as BodyInit, { headers: { 'Content-Type': 'audio/mp4', 'Content-Length': String(bytes.length) } })
const art = async () => ({ artwork: null, palette: ['#111111', '#222222', '#333333'] })
// Audio tests never contact lyric providers. The snapshot test injects the
// real resolver with deterministic provider content.
const processDownload = (overrides: Parameters<typeof processNextDownload>[0]) => processNextDownload({ lyrics: async () => {}, ...overrides })
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openfy-downloads-'))
  process.env.OPENFY_DATA_DIR = root
  const fixture = join(root, 'fixture.m4a')
  generateAudio(fixture, { format: 'aac', duration: 2 })
  raw = await readFile(fixture)
  resetAudioDownloads()
})
afterEach(async () => { stopAudioDownloads(); closeDatabase(); delete process.env.OPENFY_DATA_DIR; await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('persistent YouTube downloads', () => {
  it('saves lyrics before publishing and serves downloaded resources without any provider requests', async () => {
    const remote = 'https://lh3.googleusercontent.com/offline-cover=w120-h120'
    const downloadedSong = { ...song, artwork: remote }
    const cover = `${'a'.repeat(64)}.webp`, localCover = `/api/artwork/${cover}`
    await writeFile(join(dataPaths().artwork, cover), await sharp({ create: { width: 32, height: 32, channels: 3, background: '#123456' } }).webp().toBuffer())
    const provider = vi.fn(async () => ({ plainText: 'Letra descargada', lines: [{ time: 0, text: 'Letra descargada' }],
      instrumental: false, source: 'lrclib' as const, attribution: 'LRCLIB', sourceUrl: null }))
    queueAudioDownloads([downloadedSong])
    await processDownload({ open: async () => response(), artwork: async () => ({ artwork: localCover, palette: ['#123456'] }),
      lyrics: async (song, duration) => {
        expect(storedYouTubeAudio(song.videoId)).toBeNull()
        return resolveLyrics({ entry: { source: 'youtube', song }, duration }, { lrc: provider })
      } })
    expect(provider).toHaveBeenCalledTimes(1)
    const key = `youtube:${song.videoId}`
    const saved = getDatabase().select().from(lyrics).where(eq(lyrics.key, key)).get()!.result
    getDatabase().update(lyrics).set({ result: { ...saved, expiresAt: 1, format: 1 } }).where(eq(lyrics.key, key)).run()
    closeDatabase()
    const outside = vi.fn(async () => { throw new Error('Unexpected external request') })
    vi.stubGlobal('fetch', outside)
    const result = await resolveLyrics({ entry: { source: 'youtube', song: { ...downloadedSong, title: 'Stale queue' } }, duration: 999 },
      { lrc: outside, youtube: outside })
    expect(result.plainText).toBe('Letra descargada')
    expect(result.expiresAt).toBe(1)
    const prepared = await prepareArtwork(remote.replace('120-h120', '512-h512'), 1024)
    expect((await stat(prepared.path)).size).toBeGreaterThan(0)
    expect(downloadTarget({ source: 'youtube', song: downloadedSong }, readLibrary())?.artwork).toBe(localCover)
    expect(outside).not.toHaveBeenCalled()
  })

  it('keeps missing audio, artwork and lyrics local instead of fetching replacements', async () => {
    const downloadedSong = { ...song, artwork: 'https://lh3.googleusercontent.com/missing-cover=w120-h120' }
    queueAudioDownloads([downloadedSong])
    await processDownload({ open: async () => response(), artwork: art })
    const audio = storedYouTubeAudio(song.videoId)!
    await rm(join(dataPaths().originals, `${audio.asset.id}.m4a`))
    const outside = vi.fn(async () => { throw Error('Unexpected external request') })
    vi.stubGlobal('fetch', outside)
    const result = await resolveLyrics({ entry: { source: 'youtube', song: downloadedSong }, refresh: true, localOnly: true }, { lrc: outside, youtube: outside })
    expect(result.status).toBe('not_found')
    await expect(prepareArtwork(downloadedSong.artwork)).rejects.toThrow('portada local')
    expect(outside).not.toHaveBeenCalled()
    expect(getDatabase().select().from(youtubeAudio).all()).toHaveLength(1)
  })

  it('completes lyrics missing from an older download and reuses them offline after reopening', async () => {
    queueAudioDownloads([song])
    await processDownload({ open: async () => response(), artwork: art })
    const audio = storedYouTubeAudio(song.videoId)!
    const provider = vi.fn(async () => ({ plainText: 'Letra recuperada', lines: [{ time: 0, text: 'Letra recuperada' }],
      instrumental: false, source: 'lrclib' as const, attribution: 'LRCLIB', sourceUrl: 'https://lrclib.net' }))
    const entry = { source: 'youtube' as const, song: { ...song, title: 'Stale queue' } }
    const result = await resolveLyrics({ entry, duration: 999 }, { lrc: provider })
    expect(result.status).toBe('synced')
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({ title: song.title, duration: audio.duration }))
    closeDatabase()
    const outside = vi.fn(async () => { throw Error('offline') })
    expect(await resolveLyrics({ entry }, { lrc: outside, youtube: outside })).toEqual(result)
    expect(outside).not.toHaveBeenCalled()
    expect(storedYouTubeAudio(song.videoId)).toEqual(audio)
  })

  it('retries a downloaded not-found result and retains recovered lyrics during an outage', async () => {
    queueAudioDownloads([song])
    await processDownload({ open: async () => response(), artwork: art })
    const entry = { source: 'youtube' as const, song }
    const absent = await resolveLyrics({ entry }, { lrc: async () => null, youtube: async () => null })
    expect(absent.status).toBe('not_found')
    const provider = vi.fn(async () => ({ plainText: 'Letra recuperada', lines: [], instrumental: false,
      source: 'lrclib' as const, attribution: 'LRCLIB', sourceUrl: 'https://lrclib.net' }))
    expect((await resolveLyrics({ entry }, { lrc: provider })).status).toBe('not_found')
    expect(provider).not.toHaveBeenCalled()
    const recovered = await resolveLyrics({ entry, refresh: true }, { lrc: provider })
    expect(recovered.status).toBe('plain')
    expect(provider).toHaveBeenCalledTimes(1)
    const outside = vi.fn(async () => { throw Error('offline') })
    expect(await resolveLyrics({ entry, refresh: true }, { lrc: outside, youtube: outside })).toEqual(recovered)
    expect(getDatabase().select().from(lyrics).where(eq(lyrics.key, recovered.key)).get()?.result).toEqual(recovered)
  })

  it('backfills old downloads once, survives restarts, and backs off during outages', async () => {
    queueAudioDownloads([song])
    await processDownload({ open: async () => response(), artwork: art })
    const provider = vi.fn(async () => ({ plainText: 'Letra completada en segundo plano', lines: [], instrumental: false,
      source: 'lrclib' as const, attribution: 'LRCLIB', sourceUrl: 'https://lrclib.net' }))
    let now = Date.now()
    const resolver = vi.fn((request: Parameters<typeof resolveLyrics>[0]) => resolveLyrics(request, { lrc: provider, now: () => now }))
    const backfill = new DownloadedLyricsBackfill(resolver, () => now)
    expect(await backfill.step()).toBe(1000)
    expect(await backfill.step()).toBe(60_000)
    expect(provider).toHaveBeenCalledTimes(1)
    closeDatabase()
    expect(await new DownloadedLyricsBackfill(resolver, () => now).step()).toBe(60_000)
    expect(provider).toHaveBeenCalledTimes(1)
    getDatabase().delete(lyrics).run()
    const unavailable = vi.fn(async () => { throw Error('offline') })
    const retry = new DownloadedLyricsBackfill(unavailable, () => now)
    expect(await retry.step()).toBe(60_000)
    now += 60_000
    await retry.step()
    expect(unavailable).toHaveBeenCalledTimes(1)
    now += 300_000
    await retry.step()
    expect(unavailable).toHaveBeenCalledTimes(2)
    expect(storedYouTubeAudio(song.videoId)).not.toBeNull()
  })

  it('does not substitute a remote cover when a complete download has no local cover', async () => {
    expect(localArtwork('https://i.ytimg.com/vi/download001/hqdefault.jpg')).toBeNull()
    expect(localArtwork(`/api/artwork/${'a'.repeat(64)}.webp`)).toBe(`/api/artwork/${'a'.repeat(64)}.webp`)
    queueAudioDownloads([{ ...song, artwork: 'https://i.ytimg.com/vi/download001/hqdefault.jpg' }])
    await processDownload({ open: async () => response(), artwork: art })
    const library = readLibrary()
    expect(collectionMap(library.tracks, library.youtubeSongs).get('youtube:download001')?.artwork).toBeNull()
    expect(downloadTarget({ source: 'youtube', song }, library)?.artwork).toBeNull()
    const outside = vi.fn(async () => { throw Error('Unexpected external request') })
    expect((await resolveLyrics({ entry: { source: 'youtube', song: { ...song, videoId: 'notdownload' } }, localOnly: true },
      { lrc: outside, youtube: outside })).status).toBe('not_found')
    expect(outside).not.toHaveBeenCalled()
  })

  it('reads asynchronous library and download snapshots without claiming missing or truncated files', async () => {
    queueAudioDownloads([song])
    await processDownload({ open: async () => response(), artwork: art })
    expect(await readLibraryAsync()).toEqual(readLibrary())
    expect(await readAudioDownloadsAsync()).toEqual(readAudioDownloads())
    const audio = storedYouTubeAudio(song.videoId)!
    const path = join(root, 'originals', audio.asset.id + '.m4a')
    await writeFile(path, new Uint8Array(10))
    expect((await readLibraryAsync()).youtubeSongs![0]?.localAudio).toBeUndefined()
    expect((await readAudioDownloadsAsync())[0]).toMatchObject({ state: 'failed', errorCode: 'MISSING_FILE' })
    await rm(path)
    expect((await readLibraryAsync()).youtubeSongs![0]?.localAudio).toBeUndefined()
    expect((await readAudioDownloadsAsync())[0]).toMatchObject({ state: 'failed', errorCode: 'MISSING_FILE' })
  })
  it('publishes verified AAC under the same catalog identity and keeps favorites', async () => {
    saveYouTubeSong({ song, favorite: true })
    const [first] = queueAudioDownloads([song, song])
    expect(readAudioDownloads()).toHaveLength(1)
    await processDownload({ open: async () => response(), artwork: art })
    const audio = storedYouTubeAudio(song.videoId)!
    expect(audio.duration).toBeGreaterThan(1.8)
    expect(audio.asset.hash).toMatch(/^[a-f0-9]{64}$/)
    expect((await stat(join(root, 'originals', audio.asset.id + '.m4a'))).size).toBe(audio.asset.bytes)
    const library = readLibrary()
    expect(library.tracks).toHaveLength(0)
    expect(library.youtubeSongs![0]).toMatchObject({ favorite: true, localAudio: { asset: { id: audio.asset.id } } })
    expect([...collectionMap(library.tracks, library.youtubeSongs).keys()]).toEqual(['youtube:download001'])
    expect(downloadTarget({ source: 'youtube', song }, library)?.asset.id).toBe(audio.asset.id)
    closeDatabase()
    expect(storedYouTubeAudio(song.videoId)?.asset.hash).toBe(audio.asset.hash)
    await removeYouTubeAudio(song.videoId)
    queueAudioDownloads([song])
    await processDownload({ open: async () => response(), artwork: art })
    expect(readAudioDownloads()[0]?.id).toBe(first!.id)
    expect(storedYouTubeAudio(song.videoId)?.asset.id).not.toBe(audio.asset.id)
  })
  it('queues new playlist members automatically and preserves removed members and manual exclusions', async () => {
    const id = randomUUID(), second = { ...song, videoId: 'download002' }
    saveYouTubeSong({ song }); saveYouTubeSong({ song: second })
    getDatabase().insert(playlists).values({ id, name: 'Offline', trackIds: ['youtube:download001'], revision: 1, updatedAt: 1 }).run()
    const target = await setOfflineCollection('playlist', id, true)
    await processDownload({ open: async () => response(), artwork: art })
    expect(collectionProgress(target, new Set(['youtube:download001'])).ready).toBe(true)
    getDatabase().update(playlists).set({ trackIds: ['youtube:download002'], revision: 2 }).where(eq(playlists.id, id)).run()
    reconcileOfflineCollections()
    expect(readAudioDownloads().find(job => job.videoId === second.videoId)?.state).toBe('queued')
    expect(storedYouTubeAudio(song.videoId)).not.toBeNull()
    await removeYouTubeAudio(song.videoId)
    getDatabase().update(playlists).set({ trackIds: ['youtube:download001', 'youtube:download002'], revision: 3 }).where(eq(playlists.id, id)).run()
    reconcileOfflineCollections()
    expect(readAudioDownloads().find(job => job.videoId === song.videoId)).toMatchObject({ state: 'removed', suppressed: true })
    queueAudioDownloads([song])
    expect(readAudioDownloads().find(job => job.videoId === song.videoId)).toMatchObject({ state: 'queued', suppressed: false })
    await setOfflineCollection('playlist', id, false)
    expect(readLibrary().youtubeSongs).toHaveLength(2)
  })
  it('never publishes truncated or corrupt audio', async () => {
    queueAudioDownloads([song])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await processDownload({ open: async () => new Response(raw.slice(0, 50), { headers: { 'Content-Length': String(raw.length) } }), artwork: art })
    expect(readAudioDownloads()[0]).toMatchObject({ state: 'failed', errorCode: 'INCOMPLETE_AUDIO' })
    expect(storedYouTubeAudio(song.videoId)).toBeNull()
    expect(getDatabase().select().from(youtubeAudio).all()).toHaveLength(0)
    changeAudioDownload(readAudioDownloads()[0]!.id, 'retry')
    await processDownload({ open: async () => response(new Uint8Array(100)), artwork: art })
    expect(readAudioDownloads()[0]?.state).toBe('failed')
    expect(warn).toHaveBeenCalled()
  })
  it('retries transient failures and keeps cancellation suppressed across reconciliation', async () => {
    const [job] = queueAudioDownloads([song])
    const open = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(response())
    await processDownload({ open, wait: async () => {}, artwork: art })
    expect(open).toHaveBeenCalledTimes(2)
    expect(readAudioDownloads()[0]).toMatchObject({ state: 'ready', attempts: 2 })
    const [other] = queueAudioDownloads([{ ...song, videoId: 'download002' }])
    changeAudioDownload(other!.id, 'cancel')
    queueAudioDownloads([{ ...song, videoId: 'download002' }], 'automatic')
    expect(readAudioDownloads().find(value => value.id === other!.id)?.state).toBe('cancelled')
    expect(readAudioDownloads().find(value => value.id === job!.id)?.state).toBe('ready')
  })
  it('recovers interrupted jobs on startup without changing completed files', async () => {
    const [job] = queueAudioDownloads([song])
    getDatabase().update(audioDownloads).set({ state: 'processing', bytes: 10 }).where(eq(audioDownloads.id, job!.id)).run()
    closeDatabase(); resetAudioDownloads()
    expect(readAudioDownloads()[0]).toMatchObject({ state: 'queued', bytes: 0 })
    await processDownload({ open: async () => response(), artwork: art })
    resetAudioDownloads()
    expect(readAudioDownloads()[0]?.state).toBe('ready')
    expect(storedYouTubeAudio(song.videoId)).not.toBeNull()
  })
  it('migrates a v4 database while preserving playlist revisions', () => {
    const id = randomUUID()
    getDatabase().insert(playlists).values({ id, name: 'Anterior', trackIds: [], revision: 9, updatedAt: 1 }).run()
    closeDatabase()
    const old = new Database(join(root, 'openfy.sqlite'))
    old.exec('DROP TABLE youtube_audio; DROP TABLE audio_downloads; DROP TABLE offline_collections; PRAGMA user_version = 4;'); old.close()
    expect(readLibrary().playlists[0]).toMatchObject({ id, revision: 9 })
    expect(readAudioDownloads()).toEqual([])
  })
  it('distinguishes explicit cancellation from a shutdown during an active transfer', async () => {
    const [job] = queueAudioDownloads([song])
    let opened!: () => void
    let started = new Promise<void>(resolve => { opened = resolve })
    const open = async (_id: string, options: { signal: AbortSignal }) => {
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true })
      } })
      opened()
      return new Response(body, { headers: { 'Content-Length': '100' } })
    }
    let running = processDownload({ open, artwork: art })
    await started
    changeAudioDownload(job!.id, 'cancel')
    stopAudioDownloads()
    await running
    expect(readAudioDownloads()[0]).toMatchObject({ state: 'cancelled', suppressed: true })
    resetAudioDownloads()
    changeAudioDownload(job!.id, 'retry')
    started = new Promise<void>(resolve => { opened = resolve })
    running = processDownload({ open, artwork: art })
    await started
    stopAudioDownloads(); await running
    expect(readAudioDownloads()[0]).toMatchObject({ state: 'queued', suppressed: false })
    resetAudioDownloads()
    await processDownload({ open: async () => response(), artwork: art })
    expect(readAudioDownloads()[0]?.state).toBe('ready')
  })
  it('cleans an interrupted publication without removing a committed asset', async () => {
    const [job] = queueAudioDownloads([song]), candidate = randomUUID()
    const marker = join(root, 'staging', `${job!.id}.download-publish.json`), orphan = join(root, 'originals', `${candidate}.m4a`)
    await writeFile(orphan, raw); await writeFile(marker, JSON.stringify({ assetId: candidate }))
    resetAudioDownloads()
    await expect(stat(orphan)).rejects.toThrow()
    await processDownload({ open: async () => response(), artwork: art })
    const published = storedYouTubeAudio(song.videoId)!
    await writeFile(marker, JSON.stringify({ assetId: published.asset.id }))
    resetAudioDownloads()
    expect((await stat(join(root, 'originals', `${published.asset.id}.m4a`))).size).toBe(published.asset.bytes)
  })
})
