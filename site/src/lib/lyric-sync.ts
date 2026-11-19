import { escapeHtml } from './i18n'
import { lyricExcerpt } from './media'

const excerpt = lyricExcerpt()
const lines = excerpt.lines.map((line, index) => {
  const end = excerpt.lines[index + 1]?.time ?? line.end ?? excerpt.duration
  const words = line.words?.length
    ? line.words.map((word, i, timed) => ({
        ...word,
        end: timed[i + 1]?.time ?? line.end ?? end
      }))
    : line.text.split(/\s+/).map((text, i, parts) => ({
        text,
        time: line.time + (end - line.time) * i / parts.length,
        end: line.time + (end - line.time) * (i + 1) / parts.length
      }))
  return { time: line.time, words }
})

const previewLine = lines[1] ?? lines[0]
const previewWord = previewLine?.words[Math.floor(previewLine.words.length / 2)]
export const lyricPreviewTime = previewWord?.time ?? previewLine?.time ?? 0

/** Where scroll-scrubbed timelines stop: inside the second-to-last line, so an upcoming line stays visible below it. */
const lastButOne = lines[lines.length - 2] ?? lines[0]
export const lyricScrubEnd = lastButOne ? (lastButOne.time + (lastButOne.words.at(-1)?.end ?? lastButOne.time)) / 2 : 0

export function lyricLines(className = 'lyric') {
  return lines.map(({ words }, i) => `<p class="${className}" data-i="${i}">${words.map(word =>
    `<span class="lyric-word">${escapeHtml(word.text.trim())}</span>`).join(' ')}</p>`).join('')
}

interface TrackState {
  lines: HTMLElement[]
  words: HTMLElement[][]
  active: number
}

const tracks = new WeakMap<HTMLElement, TrackState>()
const viewports = new WeakMap<Element, HTMLElement>()

function align(track: HTMLElement, line: HTMLElement) {
  const height = track.parentElement?.clientHeight ?? 0
  const anchor = Number(track.dataset.anchor ?? .34)
  track.style.transform = `translateY(${Math.round(height * anchor - line.offsetTop - line.offsetHeight / 2)}px)`
}

const resize = new ResizeObserver(entries => {
  for (const { target } of entries) {
    const track = viewports.get(target) ?? target as HTMLElement
    const state = tracks.get(track)
    const line = state?.lines[state.active]
    if (line) align(track, line)
  }
})

export function setLyricTime(track: HTMLElement, seconds: number) {
  let state = tracks.get(track)
  if (!state) {
    const elements = Array.from(track.children) as HTMLElement[]
    state = { lines: elements, words: elements.map(line => [...line.querySelectorAll<HTMLElement>('.lyric-word')]), active: -1 }
    tracks.set(track, state)
    resize.observe(track)
    if (track.parentElement) {
      viewports.set(track.parentElement, track)
      resize.observe(track.parentElement)
    }
  }

  const active = Math.max(0, lines.findLastIndex(line => line.time <= seconds))
  const line = state.lines[active]
  if (!line) return

  if (state.active !== active) {
    state.active = active
    state.lines.forEach((element, index) => {
      element.classList.toggle('on', index === active)
      element.style.setProperty('--distance', String(Math.abs(index - active)))
    })
    align(track, line)
  }

  const timing = lines[active]!.words
  state.words[active]?.forEach((word, i) => {
    const { time, end } = timing[i]!
    const progress = Math.max(0, Math.min(1, (seconds - time) / Math.max(.001, end - time)))
    const value = String(progress)
    if (word.style.getPropertyValue('--p') === value) return
    word.style.setProperty('--p', value)
    word.classList.toggle('is-sung', progress === 1)
    word.classList.toggle('is-filling', progress > 0 && progress < 1)
  })
}
