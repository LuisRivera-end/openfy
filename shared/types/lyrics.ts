import type { PlaybackEntry } from './music'

/** A timed fragment (word or syllable) of a line; fragments concatenate to the line text, spaces included. */
export interface LyricsWord { time: number; text: string }
/** `words` exists only when the source carries real per-word timing; `end` is the source's explicit end of the last word. */
export interface LyricsLine { time: number; text: string; words?: LyricsWord[]; end?: number }
/** Bumped when parsing changes so cached results are parsed again (2: per-word timing). */
export const LYRICS_FORMAT = 2
export interface LyricsContent { plainText: string; lines: LyricsLine[]; format?: number }
export interface LyricsSignature {
  title: string
  artists: string[]
  album: string | null
  duration: number | null
}
export interface LyricsResult extends LyricsContent {
  key: string
  signature: LyricsSignature
  status: 'synced' | 'plain' | 'instrumental' | 'not_found'
  source: 'embedded' | 'lrclib' | 'youtube' | null
  attribution: string | null
  sourceUrl: string | null
  fetchedAt: number
  expiresAt: number
}
export interface LyricsRequest { entry: PlaybackEntry; duration?: number; refresh?: boolean; localOnly?: boolean }
