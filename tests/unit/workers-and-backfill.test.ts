import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase } from '../../server/database'
import { conversionPaused, setPlaybackActivity } from '../../server/utils/workers'
import { DownloadedLyricsBackfill } from '../../server/utils/downloaded-lyrics'

let root: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'openfy-workers-'))
  process.env.OPENFY_DATA_DIR = root
})
afterAll(async () => {
  closeDatabase()
  delete process.env.OPENFY_DATA_DIR
  await rm(root, { recursive: true, force: true })
})

describe('workers playback client timeout', () => {
  it('expires stale playing clients after 90s and resumes conversions', () => {
    let now = 100_000
    setPlaybackActivity('test-phone', true, now)
    expect(conversionPaused(now)).toBe(true)
    expect(conversionPaused(now + 90_000)).toBe(true)

    // After 90s (91s), client expires and conversion is no longer paused
    expect(conversionPaused(now + 91_000)).toBe(false)
  })
})

describe('downloaded lyrics backfill retries pruning', () => {
  it('prunes entries from retries map when their time has passed', async () => {
    let now = 500_000
    const resolver = vi.fn(async () => ({ key: 'k', signature: {} as never, status: 'synced' as const, source: null, lines: [], plainText: '', attribution: null, sourceUrl: null, fetchedAt: now, expiresAt: now, format: 2 }))
    const backfill = new DownloadedLyricsBackfill(resolver, () => now)
    const retries = (backfill as unknown as { retries: Map<string, number> }).retries

    retries.set('expired1', now - 1000)
    retries.set('expired2', now)
    retries.set('future', now + 60_000)

    expect(retries.size).toBe(3)
    await backfill.step()
    expect(retries.has('expired1')).toBe(false)
    expect(retries.has('expired2')).toBe(false)
    expect(retries.has('future')).toBe(true)
  })

  it('selects candidates lazily and stops at the first match', async () => {
    const { getDatabase } = await import('../../server/database')
    const { lyrics, youtubeAudio, youtubeSongs } = await import('../../server/database/schema')
    const db = getDatabase()
    let now = 1_000_000

    const song1 = { videoId: 'v1', title: 'T1', artists: ['A1'], album: null, artwork: null, duration: 100 }
    const song2 = { videoId: 'v2', title: 'T2', artists: ['A2'], album: null, artwork: null, duration: 200 }
    const song3 = { videoId: 'v3', title: 'T3', artists: ['A3'], album: null, artwork: null, duration: 300 }

    db.insert(youtubeSongs).values({ videoId: 'v1', song: song1, addedAt: now }).run()
    db.insert(youtubeSongs).values({ videoId: 'v2', song: song2, addedAt: now }).run()
    db.insert(youtubeSongs).values({ videoId: 'v3', song: song3, addedAt: now }).run()

    db.insert(youtubeAudio).values({ videoId: 'v1', assetId: 'a1', duration: 100, palette: [], downloadedAt: now }).run()
    db.insert(youtubeAudio).values({ videoId: 'v2', assetId: 'a2', duration: 200, palette: [], downloadedAt: now }).run()
    db.insert(youtubeAudio).values({ videoId: 'v3', assetId: 'a3', duration: 300, palette: [], downloadedAt: now }).run()

    // v1 has valid up-to-date lyrics
    const { lyricsSignature } = await import('../../shared/utils/lyrics')
    const sig1 = lyricsSignature({ source: 'youtube', song: song1 }, undefined, 100)
    db.insert(lyrics).values({
      key: 'youtube:v1',
      result: { key: 'youtube:v1', signature: sig1, status: 'synced', source: 'lrclib', lines: [], plainText: '', attribution: null, sourceUrl: null, fetchedAt: now, expiresAt: now + 100000, format: 2 }
    }).run()

    const resolved: string[] = []
    const resolver = vi.fn(async (req: { entry: { source: 'youtube'; song: typeof song1 }; duration: number }) => {
      resolved.push(req.entry.song.videoId)
      const sig = lyricsSignature(req.entry, undefined, req.duration)
      return { key: 'youtube:' + req.entry.song.videoId, signature: sig, status: 'synced' as const, source: null, lines: [], plainText: '', attribution: null, sourceUrl: null, fetchedAt: now, expiresAt: now + 100000, format: 2 }
    })

    const backfill = new DownloadedLyricsBackfill(resolver, () => now)

    // First step should pick v2 (missing lyrics), not v1
    expect(await backfill.step()).toBe(1000)
    expect(resolved).toEqual(['v2'])

    // Save v2 lyrics to simulate completion
    const sig2 = lyricsSignature({ source: 'youtube', song: song2 }, undefined, 200)
    db.insert(lyrics).values({
      key: 'youtube:v2',
      result: { key: 'youtube:v2', signature: sig2, status: 'synced', source: 'lrclib', lines: [], plainText: '', attribution: null, sourceUrl: null, fetchedAt: now, expiresAt: now + 100000, format: 2 }
    }).run()

    // Second step should pick v3
    expect(await backfill.step()).toBe(1000)
    expect(resolved).toEqual(['v2', 'v3'])
  })
})
