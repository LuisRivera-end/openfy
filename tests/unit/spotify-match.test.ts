import { describe, expect, it, vi } from 'vitest'
import type { YouTubeSong } from '../../shared/types/music'
import { matchSpotifyTrack } from '../../server/utils/music-spotify-match'

function song(videoId: string, title: string, artist: string, album: string | null = null, duration: number | null = null): YouTubeSong {
  return { videoId, title, artists: [artist], album, duration, artwork: null }
}

describe('Spotify song matching', () => {
  it('matches across accents and searches by the original title and main artist', async () => {
    const result = song('v01', 'Titi Me Pregunto', 'Bad Bunny', 'Un Verano Sin Ti')
    const search = vi.fn(async () => [result, song('v02', 'Tití Me Preguntó', 'KIDZ BOP Kids')])
    expect(await matchSpotifyTrack({ title: 'Tití Me Preguntó', artists: ['Bad Bunny'], album: 'Un Verano Sin Ti' }, search))
      .toMatchObject({ status: 'matched', song: result })
    expect(search.mock.calls).toEqual([['Tití Me Preguntó Bad Bunny']])
  })

  it('normalizes featured credits, remasters and deluxe album labels', async () => {
    const lucky = song('v01', 'Get Lucky - Remastered 2011', 'Daft Punk & Pharrell Williams', 'Random Access Memories')
    const results = [lucky, song('v02', 'Get Lucky', 'Daft Punk', 'Get Lucky')]
    expect(await matchSpotifyTrack({
      title: 'Get Lucky (feat. Pharrell Williams)', artists: ['Daft Punk x Pharrell Williams'],
      album: 'Random Access Memories (Deluxe)',
    }, async () => results)).toMatchObject({ status: 'matched', song: lucky })

    const bowie = song('v03', 'Life on Mars?', 'David Bowie', 'Hunky Dory')
    expect(await matchSpotifyTrack({ title: 'Life on Mars? (Remastered)', artists: ['David Bowie'] }, async () => [bowie]))
      .toMatchObject({ status: 'matched', song: bowie })
  })

  it('checks the primary artist in combined credits', async () => {
    const original = song('v01', 'Ojitos Lindos', 'Bad Bunny x Bomba Estéreo')
    const cover = song('v02', 'Ojitos Lindos', 'Bomba Estéreo')
    expect(await matchSpotifyTrack({ title: 'Ojitos Lindos', artists: ['Bad Bunny & Bomba Estereo'] }, async () => [cover, original]))
      .toMatchObject({ status: 'matched', song: original })
  })

  it('keeps live versions apart when only the catalog album labels them', async () => {
    const studio = song('v01', 'Dreams', 'Fleetwood Mac', 'Rumours')
    const live = song('v02', 'Dreams', 'Fleetwood Mac', 'Rumours (Live)')
    expect(await matchSpotifyTrack({ title: 'Dreams', artists: ['Fleetwood Mac'], album: 'Rumours' }, async () => [live, studio]))
      .toMatchObject({ status: 'matched', song: studio, candidates: [studio] })
  })

  it.each(['(Remix)', '- Live', '(Acoustic)', '- Live Acoustic Version'])('keeps %s separate from the original in both directions', async suffix => {
    const studio = song('v01', 'No Me Conoce', 'Jhay Cortez')
    const alternate = song('v02', `No Me Conoce ${suffix}`, 'Jhay Cortez')
    const track = (value: YouTubeSong) => ({ title: value.title, artists: value.artists })
    for (const [source, candidate] of [[studio, alternate], [alternate, studio]]) {
      expect(await matchSpotifyTrack(track(source!), async () => [candidate!])).toEqual({ status: 'missing', candidates: [], score: 0 })
    }
    expect(await matchSpotifyTrack(track(alternate), async () => [alternate])).toMatchObject({ status: 'matched', song: alternate })
  })

  it('tries the album query and merges it by video ID, using duration within three seconds', async () => {
    const studio = song('v01', 'Dreams', 'Fleetwood Mac', 'Rumours', 247)
    const short = song('v02', 'Dreams', 'Fleetwood Mac', 'Rumours', 238)
    const search = vi.fn(async (_query: string) => [short])
      .mockResolvedValueOnce([short]).mockResolvedValueOnce([short, studio])
    expect(await matchSpotifyTrack({ title: 'Dreams', artists: ['Fleetwood Mac'], album: 'Rumours', durationMs: 244000 }, search))
      .toMatchObject({ status: 'matched', song: studio, candidates: [studio, short] })
    expect(search.mock.calls).toEqual([['Dreams Fleetwood Mac'], ['Dreams Rumours']])
  })

  it('returns up to three when the best candidates nearly tie', async () => {
    const results = ['v01', 'v02', 'v03', 'v04'].map(id => song(id, 'Get Lucky', 'Daft Punk', 'Random Access Memories'))
    const result = await matchSpotifyTrack(
      { title: 'Get Lucky', artists: ['Daft Punk'], album: 'Random Access Memories' },
      async () => results,
    )
    expect(result).toMatchObject({ status: 'review', candidates: results.slice(0, 3) })
    expect(result.song).toBeUndefined()
  })

  it('asks for review when the export is missing its artist and lets provider errors propagate', async () => {
    const lucky = song('v01', 'Get Lucky', 'Daft Punk')
    const track = { title: 'Get Lucky', artists: [] }
    expect(await matchSpotifyTrack(track, async () => [lucky])).toMatchObject({ status: 'review', candidates: [lucky] })
    await expect(matchSpotifyTrack(track, async () => { throw Error('offline') })).rejects.toThrow('offline')
  })
})
