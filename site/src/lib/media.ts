import manifest from '../data/media.json'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import { escapeHtml, lang } from './i18n'

interface Album {
  title: string
  artist: string
  year: number
  cover: Record<'large' | 'small', string>
  colors: readonly [string, string, string]
  dominant: string
  motion: { video: string; poster: string; width: number; height: number; bytes: number }
  songs: { title: string; duration: number }[]
}

interface LyricLine {
  time: number
  end?: number
  text: string
  words?: { time: number; text: string }[]
}

interface LyricExcerpt {
  song: string
  artist: string
  album: string
  albumIndex: number
  attribution: string
  sourceUrl: string
  duration: number
  lines: LyricLine[]
}

const assets = import.meta.glob<string>('../assets/media/*', { eager: true, query: '?url', import: 'default' })
const mediaUrl = (filename: string) => assets[`../assets/media/${filename}`]!
const albums = manifest.albums as unknown as Album[]

export const albumCount = albums.length
export const realAlbum = (index: number) => albums[((index % albumCount) + albumCount) % albumCount]!
export const realCoverUrl = (index: number, size: 'large' | 'small' = 'large') => mediaUrl(realAlbum(index).cover[size])

function coverMarkup(index: number, className: string, size: 'large' | 'small', overlay = '') {
  const [c1, c2, c3] = realAlbum(index).colors
  const pixels = size === 'large' ? 512 : 160
  return `<div class="cover ${className}" aria-hidden="true" style="--c1:${c1};--c2:${c2};--c3:${c3}">
    <img class="cover real-cover" src="${escapeHtml(realCoverUrl(index, size))}" alt="" loading="lazy" decoding="async" width="${pixels}" height="${pixels}">${overlay}
  </div>`
}

export function realCover(index: number, className = '', size: 'large' | 'small' = 'large') {
  return coverMarkup(index, className, size)
}

export function motionCover(index: number, className = '') {
  const { motion } = realAlbum(index)
  return coverMarkup(index, className, 'large', `<video class="motion-video" muted loop playsinline preload="none"
    poster="${escapeHtml(mediaUrl(motion.poster))}" data-src="${escapeHtml(mediaUrl(motion.video))}"
    disablepictureinpicture disableremoteplayback aria-hidden="true" tabindex="-1"></video>`)
}

export function lyricExcerpt(): LyricExcerpt {
  const lyrics: LyricExcerpt | null = manifest.lyrics
  if (lyrics) return lyrics
  const sample = (lang === 'en' ? en : es).lyrics.sample
  const album = realAlbum(0)
  return {
    song: album.songs[0]?.title ?? album.title,
    artist: album.artist,
    album: album.title,
    albumIndex: 0,
    attribution: '',
    sourceUrl: '',
    duration: sample.length * 3,
    lines: sample.map((text, i) => ({ time: i * 3, text }))
  }
}

export function libraryCovers() {
  return manifest.library.map(({ title, artist, cover }) => ({ title, artist, url: mediaUrl(cover) }))
}

export async function coverPixels(url: string): Promise<Uint8ClampedArray> {
  const image = new Image()
  image.src = url
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not read artwork pixels')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return context.getImageData(0, 0, canvas.width, canvas.height).data
}
