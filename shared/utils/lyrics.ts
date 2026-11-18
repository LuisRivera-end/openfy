import { LYRICS_FORMAT, type LyricsContent, type LyricsLine, type LyricsSignature, type LyricsWord } from '../types/lyrics'
import type { PlaybackEntry, Track } from '../types/music'

export function lyricsSignature(entry: PlaybackEntry, track?: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>, duration?: number): LyricsSignature {
  const signature: LyricsSignature = entry.source === 'youtube'
    ? { title: entry.song.title, artists: entry.song.artists, album: entry.song.album, duration: entry.song.duration || null }
    : { title: track?.title || '', artists: track?.artist && track.artist !== 'Artista desconocido' ? [track.artist] : [],
      album: track?.album && track.album !== 'Sin álbum' ? track.album : null, duration: track?.duration || null }
  if (duration !== undefined && Number.isFinite(duration) && duration > 0) signature.duration = duration
  return signature
}

/** Keep version words (live, remix, acoustic…) when comparing recordings. */
export function normalizeLyricsName(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

const stampTime = (minutes: string, seconds: string, fraction: string | undefined, offset: number) =>
  Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction || 0}`) + offset

/**
 * Builds a line from timed fragments. Whitespace-only fragments join the previous word, a trailing empty
 * fragment becomes the explicit end, and the outer whitespace is trimmed so the words concatenate to the text.
 */
export function wordLine(fragments: LyricsWord[], lineTime?: number): LyricsLine | null {
  const words: LyricsWord[] = []
  let end: number | undefined
  fragments.forEach((fragment, index) => {
    if (!fragment.text.trim()) {
      if (index === fragments.length - 1 && !fragment.text) end = fragment.time
      else if (words.length) words[words.length - 1]!.text += fragment.text
      return
    }
    words.push({ time: Math.max(0, fragment.time), text: fragment.text })
  })
  if (!words.length) return null
  words[0]!.text = words[0]!.text.trimStart()
  words[words.length - 1]!.text = words[words.length - 1]!.text.trimEnd()
  const line: LyricsLine = { time: Math.max(0, lineTime ?? words[0]!.time), text: words.map(word => word.text).join(''), words }
  if (end !== undefined && end >= words[words.length - 1]!.time) line.end = end
  return line
}

/** Per-word timing is kept only when it is increasing and stays inside its line. */
function validWords(line: LyricsLine, next: number | undefined) {
  const words = line.words!
  if (words[0]!.time < line.time - .5) return false
  for (let i = 1; i < words.length; i++) if (words[i]!.time < words[i - 1]!.time) return false
  const last = line.end ?? words[words.length - 1]!.time
  return next === undefined || last <= next + .5
}

const inlineStamp = /<(\d+):(\d{2})(?:[.:](\d{1,3}))?>/g

/** One timed line; enhanced (A2) inline `<mm:ss.xx>` word stamps become `words` and are never shown as text. */
export function timedLine(time: number, content: string, offset = 0): LyricsLine {
  const tags = [...content.matchAll(inlineStamp)].filter(match => Number(match[2]) < 60)
  const text = tags.length ? content.replace(inlineStamp, '').replace(/\s+/g, ' ').trim() : content.trim()
  const line: LyricsLine = { time: Math.max(0, time), text }
  if (!tags.length) return line
  const fragments: LyricsWord[] = []
  const lead = content.slice(0, tags[0]!.index)
  if (lead.trim()) fragments.push({ time: line.time, text: lead })
  tags.forEach((tag, i) => fragments.push({ time: stampTime(tag[1]!, tag[2]!, tag[3], offset), text: content.slice(tag.index! + tag[0].length, tags[i + 1]?.index ?? content.length) }))
  const timed = wordLine(fragments, line.time)
  return timed && timed.text.replace(/\s+/g, ' ') === text ? timed : line
}

/** Drops per-word timing that decreases or runs past the next line. Lines must be sorted. */
export function checkWordTiming(lines: LyricsLine[]) {
  lines.forEach((line, i) => {
    if (line.words && !validWords(line, lines[i + 1]?.time)) { delete line.words; delete line.end }
  })
  return lines
}

/** Standard LRC plus enhanced (A2) word stamps. */
export function parseLrc(input: string): LyricsContent {
  const lines: LyricsLine[] = []
  const offset = Number(input.match(/\[offset:\s*([+-]?\d+)\s*\]/i)?.[1] || 0) / 1000
  const stamp = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g
  for (const row of input.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const matches = [...row.matchAll(stamp)].filter(match => Number(match[2]) < 60)
    const content = row.replace(stamp, '')
    for (const match of matches) {
      const time = stampTime(match[1]!, match[2]!, match[3], offset)
      if (Number.isFinite(time)) lines.push(timedLine(time, content, offset))
    }
  }
  lines.sort((a, b) => a.time - b.time)
  checkWordTiming(lines)
  return { lines, plainText: lines.map(line => line.text).join('\n').trim(), format: LYRICS_FORMAT }
}

/**
 * The word being sung inside the active line: index -1 before the first word, progress 0..1 across the word.
 * A word lasts until the next word, the line's explicit end, or the next line. Null when the line has no word timing.
 */
export function activeLyricsWord(line: LyricsLine | undefined, nextTime: number | null | undefined, position: number): { index: number; progress: number } | null {
  const words = line?.words
  if (!words?.length) return null
  if (position < words[0]!.time) return { index: -1, progress: 0 }
  let low = 0, high = words.length - 1, found = 0
  while (low <= high) {
    const middle = (low + high) >>> 1
    if (words[middle]!.time <= position) { found = middle; low = middle + 1 }
    else high = middle - 1
  }
  const start = words[found]!.time
  const end = words[found + 1]?.time ?? line!.end ?? nextTime ?? start + 1
  return { index: found, progress: end <= start ? 1 : Math.min(1, Math.max(0, (position - start) / (end - start))) }
}

/** All lines at the latest timestamp are active; empty lines mark instrumental gaps. */
export function activeLyricsTime(lines: LyricsLine[], position: number): number | null {
  let low = 0, high = lines.length - 1, found = -1
  while (low <= high) {
    const middle = (low + high) >>> 1
    if (lines[middle]!.time <= position) { found = middle; low = middle + 1 }
    else high = middle - 1
  }
  return found < 0 ? null : lines[found]!.time
}

export function sameLyricsSignature(left: LyricsSignature, right: LyricsSignature) {
  return normalizeLyricsName(left.title) === normalizeLyricsName(right.title)
    && left.artists.map(normalizeLyricsName).join('|') === right.artists.map(normalizeLyricsName).join('|')
    && normalizeLyricsName(left.album || '') === normalizeLyricsName(right.album || '')
    && (left.duration === null && right.duration === null
      || left.duration !== null && right.duration !== null && Math.abs(left.duration - right.duration) <= 2)
}

export const lyricsExpiry = (status: LyricsResultStatus, now = Date.now()) => now + (status === 'not_found' ? 1 : 30) * 86400000
type LyricsResultStatus = 'synced' | 'plain' | 'instrumental' | 'not_found'
