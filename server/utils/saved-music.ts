import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDatabase } from '../database'
import { tracks, youtubeSongs } from '../database/schema'
import type { YouTubeSong } from '../../shared/types/music'
import { captureFavorite } from './device-sync'

const shortText = z.string().trim().min(1).max(1000)
export const youtubeSongSchema = z.object({
  genres: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: shortText,
  artists: z.array(shortText).max(50),
  album: z.string().max(1000).nullable(),
  artwork: z.string().url().max(4000).refine(value => {
    const url = new URL(value)
    return url.protocol === 'https:' && /(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/.test(url.hostname)
  }, 'Portada de YouTube no válida.').nullable(),
  duration: z.number().finite().nonnegative().max(86400).nullable(),
  artistRefs: z.array(z.object({ id: z.string().max(300).nullable(), name: shortText })).max(50).optional(),
  albumId: z.string().max(300).nullable().optional(),
})
export const savedSongSchema = z.object({ song: youtubeSongSchema, favorite: z.boolean().optional() })
export const collectionIdSchema = z.union([z.string().uuid(), z.string().regex(/^youtube:[\w-]{11}$/)])

/**
 * Clients send the song as they received it (search, artist shelves), which often
 * lacks the album or genres the server resolved later. Keep what is already known.
 */
export function mergeSavedSong<T extends YouTubeSong>(song: T, previous?: YouTubeSong): T {
  if (!previous) return song
  const keepAlbum = !song.album && !!previous.album
  return { ...song,
    ...(keepAlbum ? { album: previous.album, ...(previous.albumId ? { albumId: previous.albumId } : {}) } : {}),
    ...(!song.genres?.length && previous.genres ? { genres: previous.genres } : {}) }
}

export function saveYouTubeSong(input: z.infer<typeof savedSongSchema>) {
  const db = getDatabase()
  const { favorite } = input
  const previous = db.select({ song: youtubeSongs.song }).from(youtubeSongs).where(eq(youtubeSongs.videoId, input.song.videoId)).get()?.song
  const song = mergeSavedSong(input.song, previous)
  const result = db.insert(youtubeSongs).values({ videoId: song.videoId, song, favorite: favorite ?? false, addedAt: Date.now() })
    .onConflictDoUpdate({ target: youtubeSongs.videoId, set: { song, ...(favorite === undefined ? {} : { favorite }) } })
    .returning({ song: youtubeSongs.song, favorite: youtubeSongs.favorite, addedAt: youtubeSongs.addedAt }).get()!
  captureFavorite(song.videoId)
  return result
}

export function knownCollectionIds() {
  const db = getDatabase()
  return new Set([
    ...db.select({ id: tracks.id }).from(tracks).all().map(row => row.id),
    ...db.select({ id: youtubeSongs.videoId }).from(youtubeSongs).all().map(row => `youtube:${row.id}`),
  ])
}

export function setYouTubeFavorite(id: string, favorite: boolean) {
  const result = getDatabase().update(youtubeSongs).set({ favorite }).where(eq(youtubeSongs.videoId, id)).returning().get()
  if(result) captureFavorite(id)
  return result
}
