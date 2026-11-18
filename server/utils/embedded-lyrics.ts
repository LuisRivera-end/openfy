import { TimestampFormat, type ILyricsTag } from 'music-metadata'
import { LYRICS_FORMAT, type LyricsContent, type LyricsLine, type LyricsWord } from '../../shared/types/lyrics'
import { checkWordTiming, parseLrc, timedLine, wordLine } from '../../shared/utils/lyrics'

type Timed = { time: number; text: string }

/**
 * SYLT frames may time whole lines or individual words/syllables. Fragment frames carry the line breaks
 * inside their text, so group them into lines with per-word timing. music-metadata also turns LRC text into
 * line-level millisecond entries, keeping any enhanced `<mm:ss.xx>` word stamps inside each entry.
 */
function syltLines(entries: Timed[]): LyricsLine[] {
  const breaks = entries.filter(entry => /\r?\n/.test(entry.text)).length
  const fragments = breaks > 0 && breaks < entries.length * .7 && entries.some(entry => !/\r?\n/.test(entry.text) && entry.text.trim())
  if (!fragments) return checkWordTiming(entries.map(entry => timedLine(entry.time, entry.text)))
  const lines: LyricsLine[] = []
  let current: LyricsWord[] = []
  const flush = () => { const line = wordLine(current); if (line) lines.push(line); current = [] }
  for (const entry of entries) {
    const parts = entry.text.split(/\r?\n/)
    parts.forEach((part, i) => {
      if (i > 0) flush()
      if (part) current.push({ time: entry.time, text: part })
    })
  }
  flush()
  return lines
}

export function embeddedLyrics(tags: ILyricsTag[] = []): LyricsContent | null {
  let plain: LyricsContent | null = null
  for (const tag of tags) {
    const text = tag.text?.trim() || (tag.syncText || []).map(line => line.text).join('\n').trim()
    const parsed = parseLrc(text)
    const lines = tag.timeStampFormat === TimestampFormat.milliseconds
      ? syltLines((tag.syncText || []).filter(line => typeof line.timestamp === 'number' && Number.isFinite(line.timestamp) && line.timestamp >= 0)
        .map(line => ({ time: line.timestamp! / 1000, text: line.text })).sort((a, b) => a.time - b.time))
      : parsed.lines
    if (lines.some(line => line.text)) return { lines, plainText: text && !parsed.lines.length && tag.timeStampFormat !== TimestampFormat.milliseconds ? text : lines.map(line => line.text).join('\n').trim(), format: LYRICS_FORMAT }
    if (text && !plain) plain = { plainText: text, lines: [], format: LYRICS_FORMAT }
  }
  return plain
}
