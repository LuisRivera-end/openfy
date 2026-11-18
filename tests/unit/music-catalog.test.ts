import { describe, expect, it, vi } from 'vitest'
import { normalizeAlbums, normalizeArtists, normalizeCatalogSongs, artistReferences, headerArtistReferences } from '../../server/utils/music-normalize'
import { MusicPageCache, type PageBatch } from '../../server/utils/music-search'
import type { YouTubeAlbum } from '../../shared/types/music'
import { YTMusic, YTNodes } from 'youtubei.js'
import { artistSection } from '../../server/utils/youtube-catalog'

const id = 'UC' + 'a'.repeat(22)
const otherId = 'UC' + 'b'.repeat(22)
const album: YouTubeAlbum = { id: 'MPREtest', title: 'Un álbum', artists: [{ id, name: 'Artista' }], artwork: 'https://image.example/album', year: 2024 }

describe('music catalog normalization', () => {
  it('finds Spanish artist sections by their contents without English-only getters', () => {
    const songs = Object.assign(Object.create(YTNodes.MusicShelf.prototype), { title: { text: 'Canciones más escuchadas' }, contents: [{ item_type: 'song' }] })
    const albums = Object.assign(Object.create(YTNodes.MusicCarouselShelf.prototype), { header: { title: { text: 'Álbumes' } }, contents: [{ item_type: 'album' }] })
    const singles = Object.assign(Object.create(YTNodes.MusicCarouselShelf.prototype), { header: { title: { text: 'Singles y EPs' } }, contents: [{ item_type: 'album' }] })
    const videos = Object.assign(Object.create(YTNodes.MusicCarouselShelf.prototype), { header: { title: { text: 'Vídeos' } }, contents: [{ item_type: 'video' }] })
    const sections = [videos, singles, songs, albums] as YTMusic.Artist['sections']
    expect(artistSection(sections, 'songs')).toBe(songs)
    expect(artistSection(sections, 'albums')).toBe(albums)
    expect(artistSection(sections, 'singles')).toBe(singles)
  })
  it('keeps homonymous artists distinct by ID and rejects non-artists and invalid IDs', () => {
    expect(normalizeArtists([
      { id, item_type: 'artist', name: ' Nombre ', thumbnails: [{ url: 'http://unsafe.example' }] },
      { id: otherId, item_type: 'artist', title: { text: 'Nombre' } },
      { id, item_type: 'artist', name: 'Duplicado' },
      { id: 'invalid', item_type: 'artist', name: 'Inválido' },
      { id: otherId, item_type: 'playlist', name: 'Lista' },
    ])).toEqual([{ id, name: 'Nombre', artwork: null }, { id: otherId, name: 'Nombre', artwork: null }])
  })
  it('adds album references without inventing identifiers for artist names', () => {
    expect(artistReferences([{ name: 'Solo nombre' }, { name: 'Con ID', channel_id: id }])).toEqual([{ id: null, name: 'Solo nombre' }, { id, name: 'Con ID' }])
    expect(normalizeCatalogSongs([{ id: 'abcdefghijk', item_type: 'song', title: 'Canción', artists: [{ name: 'Con ID', channel_id: id }], album: { id: album.id, name: album.title } }])[0])
      .toMatchObject({ artists: ['Con ID'], artistRefs: [{ id, name: 'Con ID' }], albumId: album.id })
  })
  it('excludes punctuation and Spanish conjunctions from collaborative album credits', () => {
    expect(headerArtistReferences({ text: 'Artista, Otro y Grupo', runs: [
      { text: 'Artista', endpoint: { payload: { browseId: id } } }, { text: ', ' },
      { text: 'Otro', endpoint: { payload: { browseId: otherId } } }, { text: ' y ' },
      { text: 'Grupo', endpoint: { payload: { browseId: 'UC' + 'c'.repeat(22) } } },
    ] })).toEqual([{ id, name: 'Artista' }, { id: otherId, name: 'Otro' }, { id: 'UC' + 'c'.repeat(22), name: 'Grupo' }])
    expect(headerArtistReferences({ text: 'Artista sin enlace', runs: [{ text: 'Artista sin enlace' }] })).toEqual([{ id: null, name: 'Artista sin enlace' }])
  })
  it('accepts video-labeled album tracks in order, inheriting artist, artwork and album', () => {
    const tracks = [
      { id: 'abcdefghijk', item_type: 'video', title: 'Primera', duration: { seconds: 120 } },
      { id: '12345678901', item_type: 'video', title: 'Segunda' },
      { id: 'abcdefghijk', item_type: 'video', title: 'Duplicada' },
      { item_type: 'video', title: 'No disponible' },
    ]
    expect(normalizeCatalogSongs(tracks)).toEqual([])
    const songs = normalizeCatalogSongs(tracks, album)
    expect(songs.map(song => song.title)).toEqual(['Primera', 'Segunda'])
    expect(songs[0]).toMatchObject({ artists: ['Artista'], artistRefs: album.artists, albumId: album.id, album: album.title, artwork: album.artwork })
    expect(songs[1]?.duration).toBeNull()
  })
  it('normalizes releases with missing metadata, preserving provider order', () => {
    expect(normalizeAlbums([
      { id: 'MPREsecond', item_type: 'album', title: { text: 'Segundo' }, year: '2023' },
      { id: 'MPREfirst', item_type: 'album', title: 'Primero', year: 'desconocido' },
      { id: 'invalid', item_type: 'album', title: 'No disponible' },
    ], album.artists)).toEqual([
      { id: 'MPREsecond', title: 'Segundo', year: 2023, artwork: null, artists: album.artists },
      { id: 'MPREfirst', title: 'Primero', year: null, artwork: null, artists: album.artists },
    ])
  })
  it('reads album search rows: a single author and a MusicThumbnail object', () => {
    const author = { name: 'Bad Bunny', channel_id: 'UC' + 'b'.repeat(22) }
    const thumbnail = { contents: [{ url: 'https://lh3.googleusercontent.com/a=w60-h60', width: 60 }, { url: 'https://lh3.googleusercontent.com/a=w544-h544', width: 544 }] }
    expect(normalizeAlbums([{ id: 'MPREverano', item_type: 'album', title: 'Un Verano Sin Ti', author, thumbnail, year: '2022' }])).toEqual([
      { id: 'MPREverano', title: 'Un Verano Sin Ti', year: 2022, artwork: 'https://lh3.googleusercontent.com/a=w544-h544', artists: [{ id: author.channel_id, name: 'Bad Bunny' }] },
    ])
  })
})

const batch = (first: number, count: number, next: PageBatch<{ id: string }>['next'] = null): PageBatch<{ id: string }> => ({ items: Array.from({ length: count }, (_, i) => ({ id: String(first + i) })), next })
describe('catalog pagination', () => {
  it('supports six artists per page and keeps query identities independent', async () => {
    const load = vi.fn(async () => batch(1, 15))
    const cache = new MusicPageCache(load, { initialSize: 6, nextSize: 6, identity: item => item.id })
    const first = await cache.page('artist:UCaaa:albums')
    expect(first.items).toHaveLength(6)
    await expect(cache.page('artist:UCaaa:singles', first.nextCursor!)).rejects.toMatchObject({ statusCode: 400 })
    await expect(cache.page('artist:UCbbb:albums', first.nextCursor!)).rejects.toMatchObject({ statusCode: 400 })
    const next = await cache.page('artist:UCaaa:albums', first.nextCursor!)
    expect(next.items).toEqual(batch(7, 6).items)
    expect(await cache.page('artist:UCaaa:albums', first.nextCursor!)).toEqual(next)
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('coalesces initial and continuation requests and preserves a cursor after failure', async () => {
    const next = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(batch(11, 20))
    const load = vi.fn(async () => batch(1, 12, next))
    const cache = new MusicPageCache(load, { initialSize: 12, nextSize: 12, identity: item => item.id })
    const [a, b] = await Promise.all([cache.page('releases'), cache.page('releases')])
    expect(a).toEqual(b); expect(load).toHaveBeenCalledTimes(1)
    await expect(cache.page('releases', a.nextCursor!)).rejects.toThrow('temporary')
    const [left, right] = await Promise.all([cache.page('releases', a.nextCursor!), cache.page('releases', a.nextCursor!)])
    expect(left).toEqual(right); expect(left.items).toEqual(batch(13, 12).items); expect(next).toHaveBeenCalledTimes(2)
  })
  it('expires sessions and evicts older sessions after reaching 100', async () => {
    let now = 0
    const cache = new MusicPageCache(async () => batch(1, 24), { initialSize: 12, nextSize: 12, identity: item => item.id }, () => now)
    const first = await cache.page('0')
    for (let n = 1; n <= 100; n++) await cache.page(String(n))
    await expect(cache.page('0', first.nextCursor!)).rejects.toMatchObject({ statusCode: 410 })
    const last = await cache.page('100')
    now = 16 * 60000
    await expect(cache.page('100', last.nextCursor!)).rejects.toMatchObject({ statusCode: 410 })
  })
})
