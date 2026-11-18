import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { closeDatabase, getDatabase } from '../../server/database'
import { playlists } from '../../server/database/schema'
import { readLibrary } from '../../server/utils/library'
import { collectionIdSchema, knownCollectionIds, savedSongSchema, saveYouTubeSong, setYouTubeFavorite } from '../../server/utils/saved-music'
import { collectionMap } from '../../shared/utils/collections'
import type { YouTubeSong } from '../../shared/types/music'

let root: string
const song: YouTubeSong = { videoId: 'abcdefghijk', title: 'Una remota', artists: ['Openfy'], album: null, artwork: null, duration: 123 }
const id = randomUUID()
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'openfy-saved-')); process.env.OPENFY_DATA_DIR = root })
afterAll(async () => { closeDatabase(); delete process.env.OPENFY_DATA_DIR; await rm(root, { recursive: true, force: true }) })

describe('saved YouTube collection references', () => {
  it('migrates a v2 library without replacing existing playlists', () => {
    getDatabase().insert(playlists).values({ id, name: 'Anterior', trackIds: [], revision: 4, updatedAt: 123 }).run()
    closeDatabase()
    const legacy = new Database(join(root, 'openfy.sqlite'))
    legacy.exec('DROP TABLE youtube_songs; PRAGMA user_version = 2;')
    legacy.close()
    expect(readLibrary().playlists.find(list => list.id === id)).toMatchObject({ name: 'Anterior', revision: 4 })
    expect(readLibrary().youtubeSongs).toEqual([])
  })
  it('upserts metadata without resetting favorite or original addition time', () => {
    const first = saveYouTubeSong({ song, favorite: true })
    const second = saveYouTubeSong({ song: { ...song, title: 'Título actualizado' } })
    expect(second).toEqual({ song: { ...song, title: 'Título actualizado' }, favorite: true, addedAt: first.addedAt })
    expect(readLibrary().youtubeSongs).toHaveLength(1)
    expect(readLibrary().tracks).toEqual([])
    expect(knownCollectionIds().has('youtube:abcdefghijk')).toBe(true)
    expect(knownCollectionIds().has('youtube:12345678901')).toBe(false)
  })
  it('persists favorite removal and resolves saved references after reopening', () => {
    expect(setYouTubeFavorite(song.videoId, false)?.favorite).toBe(false)
    expect(setYouTubeFavorite('12345678901', true)).toBeUndefined()
    closeDatabase()
    const library = readLibrary()
    const item = collectionMap(library.tracks, library.youtubeSongs).get('youtube:abcdefghijk')!
    expect(item.entry).toMatchObject({ source: 'youtube', song: { videoId: song.videoId } })
    expect(item.favorite).toBe(false)
  })
  it('rejects malformed references, unbounded metadata and non-provider artwork', () => {
    expect(collectionIdSchema.safeParse(id).success).toBe(true)
    expect(collectionIdSchema.safeParse('youtube:abcdefghijk').success).toBe(true)
    for (const invalid of ['abcdefghijk', 'youtube:../private', 'https://youtube.com/watch?v=abcdefghijk']) expect(collectionIdSchema.safeParse(invalid).success).toBe(false)
    expect(savedSongSchema.safeParse({ song }).success).toBe(true)
    expect(savedSongSchema.safeParse({ song: { ...song, videoId: 'bad' } }).success).toBe(false)
    expect(savedSongSchema.safeParse({ song: { ...song, duration: -1 } }).success).toBe(false)
    expect(savedSongSchema.safeParse({ song: { ...song, artwork: 'http://127.0.0.1/private' } }).success).toBe(false)
  })
})
