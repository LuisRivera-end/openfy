import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/desktop-contract.json'
import { restorePlayback } from '../../shared/utils/playback'
import type { PlaybackSnapshotV2, YouTubeArtistProfile } from '../../shared/types/music'
import catalog from '../fixtures/desktop-catalog-contract.json'
import { lyricsSignature, sameLyricsSignature, activeLyricsTime } from '../../shared/utils/lyrics'

describe('shared desktop playback contract', () => {
  it('uses the catalog and lyrics fixture with the TypeScript recording rules', () => {
    const song = catalog.album.songs[0]!
    expect(sameLyricsSignature(lyricsSignature({ source: 'youtube', song }), catalog.lyrics.signature)).toBe(true)
    expect(activeLyricsTime(catalog.lyrics.lines, 16)).toBe(15.5)
    expect(catalog.artist.albums[0]!.id).toBe(song.albumId)
    // The artist profile fixture is the shared shape: banner and related artists travel to .NET unchanged.
    const profile: YouTubeArtistProfile = catalog.artist
    expect(profile.similar[0]?.name).toBe('Horizonte Sur')
  })
  it('restores the mixed queue fixture without losing the remote selection', () => {
    const restored = restorePlayback(fixture as PlaybackSnapshotV2, new Map())
    expect(restored.queue).toEqual([fixture.queue[1]])
    expect(restored.index).toBe(0)
    expect(restored.position).toBe(27.25)
    expect(restored.version).toBe(2)
  })
})
