import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YTNodes } from 'youtubei.js'
import { albumPlaylistId, getYouTubeAlbum, getYouTubeArtist, getYouTubeArtistSongs } from '../../server/utils/youtube-catalog'

const provider = vi.hoisted(() => ({ getArtist: vi.fn(), getAlbum: vi.fn(), getPlaylist: vi.fn() }))
vi.mock('../../server/utils/youtube-music', () => ({ youtubeSession: async () => ({ music: provider }) }))

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

const artistId = (letter: string) => 'UC' + letter.repeat(22)
const song = (id: string, duration?: number, album?: { id: string; name: string }) => ({ id, item_type: 'song', title: 'Lo Siento BB:/',
  ...(duration ? { duration: { seconds: duration } } : {}), ...(album ? { album } : {}) })
const data = { id: 'MPREb_data', name: 'DATA' }
interface PlaylistFixture {
  items: { filterType: () => ReturnType<typeof song>[] }
  has_continuation: boolean
  getContinuation: () => Promise<PlaylistFixture | undefined>
}
const playlist = (items: ReturnType<typeof song>[], next?: PlaylistFixture): PlaylistFixture => ({
  items: { filterType: () => items }, has_continuation: !!next, getContinuation: vi.fn(async () => next),
})
function artistPage(items: ReturnType<typeof song>[]) {
  const shelf = Object.assign(Object.create(YTNodes.MusicShelf.prototype), {
    contents: items, endpoint: { payload: { browseId: 'VLOLAK5uy_artist' } },
  })
  return { header: { title: { text: 'Tainy' } }, sections: [shelf] }
}
function albumPage(url = 'https://music.youtube.com/playlist?list=OLAK5uy_album') {
  return { url, header: Object.assign(Object.create(YTNodes.MusicDetailHeader.prototype), {
    title: { text: 'DATA' }, author: { name: 'Tainy', channel_id: artistId('a') }, year: '2023',
  }), contents: [{ ...song('NO7EtdR3Dyw', 207), item_type: 'video' }], page: {} }
}

describe('catalog recording selection and lengths', () => {
  it('fills popular-song lengths by ID and reuses the full songs cache', async () => {
    provider.getArtist.mockResolvedValue(artistPage([song('RGXHqQR9XrQ'), song('12345678901', 180), song('12345678902')]))
    // Identical titles must not associate a different recording with a missing ID.
    provider.getPlaylist.mockResolvedValue(playlist([song('RGXHqQR9XrQ', 207), song('12345678901', 181), song('12345678903', 251)]))
    const profile = await getYouTubeArtist(artistId('a'))
    expect(profile.topSongs.map(song => song.duration)).toEqual([207, 180, null])
    await getYouTubeArtistSongs(artistId('a'))
    expect(provider.getPlaylist).toHaveBeenCalledTimes(1)
  })

  it('keeps the artist profile available if the supplemental playlist fails', async () => {
    provider.getArtist.mockResolvedValue(artistPage([song('RGXHqQR9XrQ')]))
    provider.getPlaylist.mockRejectedValueOnce(new Error('temporarily unavailable'))
    const profile = await getYouTubeArtist(artistId('b'))
    expect(profile.name).toBe('Tainy')
    expect(profile.topSongs[0]?.duration).toBeNull()
    expect(console.warn).toHaveBeenCalledWith('[youtube-music]', expect.stringContaining('artist-durations'))
  })

  it('does not load a supplemental playlist when popular songs already have lengths and albums', async () => {
    provider.getArtist.mockResolvedValue(artistPage([song('RGXHqQR9XrQ', 207, data)]))
    expect((await getYouTubeArtist(artistId('c'))).topSongs[0]).toMatchObject({ duration: 207, album: 'DATA', albumId: 'MPREb_data' })
    expect(provider.getPlaylist).not.toHaveBeenCalled()
  })

  it('reads the album that popular-song rows place after the play count', async () => {
    // youtubei.js only looks at the second and third columns; the artist shelf uses a fourth.
    const run = (text: string, browseId?: string) => ({ text, ...(browseId ? { endpoint: { payload: { browseId } } } : {}) })
    provider.getArtist.mockResolvedValue(artistPage([{ ...song('RGXHqQR9XrQ', 207), flex_columns: [
      { title: { runs: [run('Lo Siento BB:/')] } }, { title: { runs: [run('Tainy', artistId('t'))] } },
      { title: { runs: [run('512 M de reproducciones')] } }, { title: { runs: [run('DATA', 'MPREb_data')] } },
    ] }]))
    expect((await getYouTubeArtist(artistId('f'))).topSongs[0]).toMatchObject({ album: 'DATA', albumId: 'MPREb_data' })
    expect(provider.getPlaylist).not.toHaveBeenCalled()
  })

  it('fills missing popular-song albums by ID from the full songs list', async () => {
    provider.getArtist.mockResolvedValue(artistPage([song('RGXHqQR9XrQ', 207), song('12345678901', 180, { id: 'MPREb_other', name: 'Otro' })]))
    provider.getPlaylist.mockResolvedValue(playlist([song('RGXHqQR9XrQ', 207, data), song('12345678901', 180, data)]))
    const profile = await getYouTubeArtist(artistId('g'))
    expect(profile.topSongs.map(song => [song.album, song.albumId])).toEqual([['DATA', 'MPREb_data'], ['Otro', 'MPREb_other']])
  })

  it('keeps a wide banner apart from the portrait and lists similar artists', async () => {
    const image = (url: string, width: number) => ({ url, width })
    const immersive = Object.assign(Object.create(YTNodes.MusicImmersiveHeader.prototype), {
      title: { text: 'Tainy' }, thumbnail: { contents: [image('https://lh3.googleusercontent.com/banner=w2880-h1200-p', 2880)] },
    })
    const similar = Object.assign(Object.create(YTNodes.MusicCarouselShelf.prototype), {
      contents: [{ id: artistId('s'), item_type: 'artist', name: 'Jhay Cortez', thumbnails: [image('https://lh3.googleusercontent.com/s=w226-h226', 226)] },
        { id: artistId('d'), item_type: 'artist', name: 'Tainy' }],
    })
    provider.getArtist.mockResolvedValue({ ...artistPage([song('RGXHqQR9XrQ', 207)]), header: immersive, sections: [artistPage([song('RGXHqQR9XrQ', 207)]).sections[0], similar] })
    const profile = await getYouTubeArtist(artistId('d'))
    expect(profile.banner).toBe('https://lh3.googleusercontent.com/banner=w2880-h1200-p')
    expect(profile.similar.map(artist => artist.name)).toEqual(['Jhay Cortez'])

    const visual = Object.assign(Object.create(YTNodes.MusicVisualHeader.prototype), {
      title: { text: 'Tainy' }, thumbnail: [], foreground_thumbnail: [image('https://lh3.googleusercontent.com/face=w540-h540', 540)],
    })
    provider.getArtist.mockResolvedValue({ ...artistPage([song('RGXHqQR9XrQ', 207)]), header: visual })
    const portrait = await getYouTubeArtist(artistId('e'))
    expect(portrait).toMatchObject({ banner: null, artwork: 'https://lh3.googleusercontent.com/face=w540-h540' })
  })

  it('uses canonical album audio IDs instead of the longer music-video IDs', async () => {
    provider.getAlbum.mockResolvedValue(albumPage())
    provider.getPlaylist.mockResolvedValue(playlist([song('RGXHqQR9XrQ', 207)]))
    const album = await getYouTubeAlbum('MPRErecording')
    expect(provider.getPlaylist).toHaveBeenCalledWith('OLAK5uy_album')
    expect(album.songs).toMatchObject([{ videoId: 'RGXHqQR9XrQ', duration: 207, albumId: 'MPRErecording', album: 'DATA', artists: ['Tainy'] }])
    expect(album.songs.some(song => song.videoId === 'NO7EtdR3Dyw')).toBe(false)
  })

  it('collects all canonical album pages in order and removes repeated IDs', async () => {
    provider.getAlbum.mockResolvedValue(albumPage())
    const second = playlist([song('RGXHqQR9XrQ', 207), song('12345678901', 180)])
    provider.getPlaylist.mockResolvedValue(playlist([song('RGXHqQR9XrQ', 207)], second))
    const album = await getYouTubeAlbum('MPREcontinuation')
    expect(album.songs.map(song => song.videoId)).toEqual(['RGXHqQR9XrQ', '12345678901'])
    expect(album.songs.every(song => song.albumId === album.id)).toBe(true)
  })

  it('allows retrying a failed canonical playlist instead of silently playing the video', async () => {
    provider.getAlbum.mockResolvedValue(albumPage())
    provider.getPlaylist.mockRejectedValueOnce(new Error('temporary'))
    await expect(getYouTubeAlbum('MPREretry')).rejects.toThrow('temporary')
    provider.getPlaylist.mockResolvedValue(playlist([song('RGXHqQR9XrQ', 207)]))
    expect((await getYouTubeAlbum('MPREretry')).songs[0]?.videoId).toBe('RGXHqQR9XrQ')
  })

  it('supports older album responses without a canonical playlist', async () => {
    provider.getAlbum.mockResolvedValue(albumPage(''))
    expect((await getYouTubeAlbum('MPRElegacy')).songs[0]?.videoId).toBe('NO7EtdR3Dyw')
    expect(provider.getPlaylist).not.toHaveBeenCalled()
  })

  it('extracts only canonical album playlist identifiers', () => {
    expect(albumPlaylistId('https://music.youtube.com/playlist?list=OLAK5uy_album')).toBe('OLAK5uy_album')
    for (const url of [undefined, 'invalid', 'https://example.com/playlist?list=OLAK5uy_album',
      'https://music.youtube.com/playlist?list=unrelated', 'https://music.youtube.com/watch?list=OLAK5uy_album']) {
      expect(albumPlaylistId(url)).toBeNull()
    }
  })
})
