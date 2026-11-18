import type { YouTubeSong } from '../../shared/types/music'
import { artistParts, metadataKey, sameArtist } from '../../shared/utils/metadata-key'

export interface SpotifyMatchTrack {
  title: string
  artists: string[]
  album?: string
  durationMs?: number
  isrc?: string
}

export interface SpotifyMatch {
  status: 'matched' | 'review' | 'missing'
  song?: YouTubeSong
  candidates: YouTubeSong[]
  score: number
}

const SUFFIX = /(?:\s*[([]([^()[\]]+)[)\]]|(?:\s+-\s+|\s*[–—]\s*)([^-–—]+))\s*$/u
const EDITION = /^(?:(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+\d{4})?|(?:super\s+)?deluxe(?:\s+(?:edition|version))?)$/iu
const RECORDING_VERSION = /\b(?:remix|mix|live|en vivo|directo|acoustic|ac[uú]stic[oa]|unplugged|instrumental|karaoke|demo|cover|radio edit|extended|sped up|slowed)\b/iu

function recording(value: string) {
  let title = value.replace(/[([]\s*(?:feat|ft|featuring|with|con)\b[^)\]]*[)\]]/giu, ' ').trim()
  const versions: string[] = []
  // Strip edition labels while retaining the identity of an alternate recording.
  for (let suffix = SUFFIX.exec(title); suffix; suffix = SUFFIX.exec(title)) {
    const label = (suffix[1] || suffix[2] || '').trim()
    if (RECORDING_VERSION.test(label)) {
      versions.push(metadataKey(label.replace(/\b(?:version|versi[oó]n)\b/giu, '')))
    } else if (!EDITION.test(label)) break
    title = title.slice(0, suffix.index).trim()
  }
  return { key: metadataKey(title), version: versions.sort().join(':') }
}

function artistMatch(source: string, candidate: string) {
  const key = metadataKey(source)
  if (!key) return false
  if (sameArtist({ artistName: candidate }, [source])) return true
  if (!/\s(?:&|x|feat\.?|ft\.?)\s/iu.test(source)) return false
  const main = artistParts(source)[0] || key
  return sameArtist({ artistName: candidate }, [main])
}

/** Catalog song searches are injected so this also runs in Android's provider. */
export async function matchSpotifyTrack(
  track: SpotifyMatchTrack,
  search: (query: string) => Promise<YouTubeSong[]>,
): Promise<SpotifyMatch> {
  const target = recording(track.title)
  const album = track.album ? recording(track.album) : undefined
  const targetVersion = target.version || album?.version || ''
  const artists = track.artists.map(artist => artist.trim()).filter(Boolean)
  const main = artists[0]
  if (!target.key) return { status: 'missing', candidates: [], score: 0 }

  const ranked = new Map<string, { song: YouTubeSong; confident: boolean; score: number }>()
  const tryQuery = async (query: string) => {
    for (const song of await search(query)) {
      const candidate = recording(song.title)
      const candidateAlbum = song.album ? recording(song.album) : undefined
      const version = candidate.version || candidateAlbum?.version || ''
      if (candidate.key !== target.key || version !== targetVersion) continue
      const mainMatch = !!main && song.artists.some(artist => artistMatch(main, artist))
      const overlap = artists.filter(source => song.artists.some(artist => artistMatch(source, artist))).length
      const albumMatch = !!album?.key && album.key === candidateAlbum?.key && album.version === candidateAlbum.version
      // A same-title song with an unrelated credited artist needs some other evidence.
      if (main && song.artists.length && !overlap && !albumMatch) continue
      const durationDelta = track.durationMs && track.durationMs > 0 && song.duration && song.duration > 0
        ? Math.abs(track.durationMs - song.duration * 1000)
        : null
      const durationScore = durationDelta == null ? 0 : durationDelta <= 3000 ? 10 : -10
      const score = 44 + (mainMatch ? 30 : overlap ? 12 : 0) + (albumMatch ? 12 : 0)
        + (overlap > 1 ? 4 : 0) + durationScore
      const row = { song, score, confident: mainMatch && (durationDelta == null || durationDelta <= 3000) }
      if ((ranked.get(song.videoId)?.score ?? -1) < score) ranked.set(song.videoId, row)
    }
  }
  const result = (): SpotifyMatch => {
    const [best, second, third] = [...ranked.values()].sort((a, b) => b.score - a.score)
    if (!best) return { status: 'missing', candidates: [], score: 0 }
    const candidates = [best.song, ...(second ? [second.song] : []), ...(third ? [third.song] : [])]
    if (best.confident && (!second || best.score - second.score > 8)) {
      return { status: 'matched', song: best.song, candidates, score: best.score }
    }
    return { status: 'review', candidates, score: best.score }
  }

  const query = [track.title.trim(), main].filter(Boolean).join(' ')
  await tryQuery(query)
  const first = result()
  const albumQuery = track.album?.trim() && `${track.title.trim()} ${track.album.trim()}`
  if (first.status === 'matched' || !albumQuery || metadataKey(albumQuery) === metadataKey(query)) return first
  await tryQuery(albumQuery)
  return result()
}
