import { eq } from 'drizzle-orm'
import { join } from 'node:path'
import { parseFile } from 'music-metadata'
import { dataPaths, getDatabase } from '../database'
import { assets, lyrics, tracks, youtubeAudio, youtubeSongs } from '../database/schema'
import { embeddedLyrics } from './embedded-lyrics'
import { lrcClient, LyricsProviderError, type ProviderLyrics } from './lrclib'
import { youtubeSession } from './youtube-music'
import { lyricsExpiry, lyricsSignature, sameLyricsSignature } from '../../shared/utils/lyrics'
import { playbackKey } from '../../shared/utils/playback'
import { LYRICS_FORMAT, type LyricsContent, type LyricsRequest, type LyricsResult, type LyricsSignature } from '../../shared/types/lyrics'

export class LyricsTrackNotFound extends Error {}

async function localLyrics(trackId: string) {
  const db = getDatabase()
  const track = db.select().from(tracks).where(eq(tracks.id, trackId)).get()
  if (!track) throw new LyricsTrackNotFound()
  // Content parsed by an older format is read from the file again (e.g. to pick up per-word timing).
  if (track.lyricsScanned && (!track.embeddedLyrics || track.embeddedLyrics.format === LYRICS_FORMAT)) return { track, content: track.embeddedLyrics }
  const asset = db.select().from(assets).where(eq(assets.id, track.originalId)).get()
  if (!asset) throw new LyricsProviderError('No se encontró el archivo original para consultar sus letras.')
  let content: LyricsContent | null
  try { content = embeddedLyrics((await parseFile(join(dataPaths().originals, asset.filename), { skipCovers: true })).common.lyrics) }
  catch { throw new LyricsProviderError('No se pudo leer la letra del archivo original. Vuelve a intentarlo.') }
  db.update(tracks).set({ embeddedLyrics: content, lyricsScanned: true }).where(eq(tracks.id, trackId)).run()
  return { track, content }
}

export async function youtubeLyrics(videoId: string): Promise<ProviderLyrics | null> {
  try {
    const shelf = await (await youtubeSession()).music.getLyrics(videoId)
    const plainText = shelf?.description.toString().trim()
    if (!plainText) return null
    return { plainText, lines: [], instrumental: false, source: 'youtube',
      attribution: shelf?.footer?.toString().trim() || 'Letras de YouTube Music', sourceUrl: `https://music.youtube.com/watch?v=${videoId}` }
  } catch (error) {
    // The SDK throws for a missing/disabled lyrics tab. Network/parser failures are retryable.
    if (error instanceof Error && /Could not find target tab|lyrics (?:are |is )?not available|letras no (?:están )?disponibles/i.test(error.message)) return null
    throw new LyricsProviderError()
  }
}

export interface LyricsDependencies {
  lrc: (signature: LyricsSignature) => Promise<ProviderLyrics | null>
  youtube: (id: string) => Promise<ProviderLyrics | null>
  now: () => number
}
const pending = new Map<string, Promise<LyricsResult>>()
export const latestSignatures = new Map<string, string>()

export async function resolveLyrics(request: LyricsRequest, dependencies: Partial<LyricsDependencies> = {}): Promise<LyricsResult> {
  const deps = { lrc: (signature: LyricsSignature) => lrcClient.get(signature), youtube: youtubeLyrics, now: Date.now, ...dependencies }
  const entry = request.entry
  const key = playbackKey(entry)
  // Record intent before asynchronous file inspection can reorder requests.
  const intent = JSON.stringify([entry, request.duration])
  latestSignatures.set(key, intent)
  try {
    const downloaded = entry.source === 'youtube'
      ? getDatabase().select().from(youtubeAudio).where(eq(youtubeAudio.videoId, entry.song.videoId)).get() : undefined
    let embedded: LyricsContent | null = null
    let signature: LyricsSignature
    if (entry.source === 'local') {
      const local = await localLyrics(entry.trackId)
      embedded = local.content
      signature = lyricsSignature(entry, local.track.metadata, request.duration)
    } else {
      const saved = downloaded && getDatabase().select().from(youtubeSongs).where(eq(youtubeSongs.videoId, entry.song.videoId)).get()
      signature = lyricsSignature(saved ? { source: 'youtube', song: saved.song } : entry, undefined, downloaded?.duration ?? request.duration)
    }
    const cached = getDatabase().select().from(lyrics).where(eq(lyrics.key, key)).get()?.result
    const matchingCache = cached && sameLyricsSignature(cached.signature, signature) ? cached : undefined
    // Keep useful downloaded lyrics offline regardless of age or parser version.
    // Older downloads may have no lyrics: allow those to be completed online,
    // and let an explicit retry refresh them without redownloading any audio.
    if (request.localOnly || (downloaded && !request.refresh && matchingCache && matchingCache.status !== 'not_found')) {
      if (cached && sameLyricsSignature(cached.signature, signature)) return cached
      const now = deps.now()
      return { key, signature, status: embedded?.lines.length ? 'synced' : embedded?.plainText ? 'plain' : 'not_found',
        source: embedded ? 'embedded' : null, lines: embedded?.lines || [], plainText: embedded?.plainText || '',
        attribution: embedded ? 'Letra incluida en tu archivo' : null, sourceUrl: null,
        fetchedAt: now, expiresAt: now, format: LYRICS_FORMAT }
    }
    if (!request.refresh && cached && cached.format === LYRICS_FORMAT && cached.expiresAt > deps.now() && sameLyricsSignature(cached.signature, signature)) return cached
    const pendingKey = JSON.stringify([key, signature])
    if (pending.has(pendingKey)) return await pending.get(pendingKey)!
    const work = (async () => {
      let chosen: ProviderLyrics | null = null
      let failure: unknown
      if (!embedded?.lines.length) {
        try { chosen = await deps.lrc(signature) } catch (error) { failure = error }
      }
      let content: LyricsContent | null = embedded?.lines.length ? embedded : chosen?.lines.length ? chosen : embedded
      if (!content && chosen) content = chosen
      let youtube: ProviderLyrics | null = null
      if (!content && entry.source === 'youtube') {
        try { youtube = await deps.youtube(entry.song.videoId); content = youtube } catch (error) { failure ||= error }
      }
      // Preserve the difference between a genuine absence and an unavailable provider.
      if (!content && failure) {
        if (downloaded && matchingCache && matchingCache.status !== 'not_found') return matchingCache
        throw failure
      }
      const source = content === embedded && embedded ? 'embedded' : youtube ? 'youtube' : chosen ? 'lrclib' : null
      const instrumental = source === 'lrclib' && chosen?.instrumental
      const status = instrumental ? 'instrumental' : content?.lines.length ? 'synced' : content?.plainText ? 'plain' : 'not_found'
      const provider = source === 'youtube' ? youtube : source === 'lrclib' ? chosen : null
      const now = deps.now()
      const result: LyricsResult = { key, signature, status, source, lines: content?.lines || [], plainText: content?.plainText || '',
        attribution: source === 'embedded' ? 'Letra incluida en tu archivo' : provider?.attribution || null,
        sourceUrl: provider?.sourceUrl || null, fetchedAt: now, expiresAt: lyricsExpiry(status, now), format: LYRICS_FORMAT }
      // A useful fallback may be served, but must not hide a transient failure for 30 days.
      if (!failure && latestSignatures.get(key) === intent) getDatabase().insert(lyrics).values({ key, result }).onConflictDoUpdate({ target: lyrics.key, set: { result } }).run()
      else result.expiresAt = now
      return result
    })()
    pending.set(pendingKey, work)
    try { return await work } finally { pending.delete(pendingKey) }
  } finally {
    if (latestSignatures.get(key) === intent) latestSignatures.delete(key)
  }
}
