import { describe, expect, it } from 'vitest'
import { describePlayback, restorePlayback, youtubeStreamUrl } from '../../shared/utils/playback'
import type { PlaybackSnapshot, PlaybackSnapshotV2, Track, YouTubeSong } from '../../shared/types/music'

const song: YouTubeSong = { videoId: 'abcdefghijk', title: 'Remota', artists: ['Artista'], album: null, artwork: null, duration: null }
const local = { id: 'local', title: 'Local' } as Track
const tracks = new Map([['local', local]])
const legacy: PlaybackSnapshot = { queue: ['missing', 'local'], index: 1, position: 12, shuffle: false, repeat: 'off', volume: 0.5 }

describe('mixed playback snapshots', () => {
  it('migrates a local snapshot and preserves the selected track and position', () => {
    expect(restorePlayback(legacy, tracks)).toEqual({ ...legacy, version: 2, queue: [{ source: 'local', trackId: 'local' }], index: 0 })
  })
  it('keeps YouTube metadata without requiring a library entry', () => {
    const snapshot: PlaybackSnapshotV2 = { ...legacy, version: 2, queue: [{ source: 'local', trackId: 'local' }, { source: 'youtube', song }] }
    expect(restorePlayback(snapshot, new Map()).queue).toEqual([{ source: 'youtube', song }])
    expect(describePlayback(snapshot.queue[1], tracks)).toMatchObject({ id: 'youtube:abcdefghijk', title: 'Remota', source: 'youtube', artist: 'Artista', album: 'YouTube Music', duration: 0 })
    expect(youtubeStreamUrl(song.videoId)).toBe('/api/music/youtube/abcdefghijk/stream')
  })
})
