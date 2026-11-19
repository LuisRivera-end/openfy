import { escapeHtml, type Translate } from './i18n'
import { icon } from './icons'
import { lyricLines } from './lyric-sync'
import { lyricExcerpt, motionCover, realAlbum, realCover } from './media'
import '../styles/devices.css'
import logo from '../assets/openfy.svg'

export { lyricLines } from './lyric-sync'

export const lyricAlbumIndex = lyricExcerpt().albumIndex

export function androidStatus(extra = '') {
  return `<div class="status"><span>2:00 ${icon('shield')}</span>
    <span class="status-icons">${extra}<strong>5G</strong><span class="status-signal"><i></i><i></i><i></i><i></i></span><b class="status-battery"></b></span>
  </div>`
}

const gestureBar = '<span class="phone-gesture"></span>'

const paletteStyle = (index: number) => {
  const [c1, c2, c3] = realAlbum(index).colors
  return `--c1:${c1};--c2:${c2};--c3:${c3}`
}

const dominantStyle = (index: number) => `--dominant:${realAlbum(index).dominant}`

const ambient = (index: number) =>
  `<div class="ambient-css"><i></i><i></i><i></i></div><canvas class="device-ambient" data-cover="${index}"></canvas>`

function songAt(index: number) {
  const album = realAlbum(index)
  const song = index === lyricAlbumIndex ? album.songs.find(song => song.title === lyricExcerpt().song) : album.songs[0]
  return { title: song?.title ?? album.title, duration: song?.duration ?? 0, artist: album.artist }
}

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

const progress = (value: number) =>
  `<div class="progress"><div class="progress-fill" style="--p:${value}"></div></div>`

function seek(position: number, duration: number, desktop = false) {
  const fraction = duration ? position / duration : 0
  return `<div class="device-seek">
    ${desktop ? `<div class="bp-slider"><i style="--p:${fraction}"></i></div>` : progress(fraction)}
    <div class="device-times"><span>${formatTime(position)}</span><span>${formatTime(duration)}</span></div>
  </div>`
}

const controls = (playing = true) =>
  `<div class="controls">${icon('shuffle', 'ctl-sm')}${icon('prev')}<span class="ctl-play">${icon(playing ? 'pause' : 'play')}</span>${icon('next')}${icon('repeat', 'ctl-sm')}</div>`

function metadata(index: number, favorite: boolean, artwork = false) {
  const { title, artist } = songAt(index)
  return `<div class="device-meta${artwork ? ' device-meta-compact' : ''}">
    ${artwork ? realCover(index, '', 'small') : ''}
    <div class="device-meta-text"><b>${escapeHtml(title)}</b><span>${escapeHtml(artist)}</span></div>
    ${icon(favorite ? 'heartFilled' : 'heart', 'device-heart')}
  </div>`
}

export function screenHome(t: Translate) {
  const tiles = [1, 4, 3].map(index =>
    `<li>${realCover(index, '', 'small')}<b>${escapeHtml(realAlbum(index).title)}</b></li>`).join('')
  const suggestions = [2, 7].map(index => {
    const album = realAlbum(index)
    return `<li style="${dominantStyle(index)}">${realCover(index)}
      <div><b>${escapeHtml(album.title)}</b><span>${escapeHtml(album.artist)}</span></div>
    </li>`
  }).join('')
  const releases = [6, 5, 7].map(index => `<li>${realCover(index)}</li>`).join('')
  const tabs = [
    ['androidHome', 'ui.home'],
    ['search', 'ui.search'],
    ['androidLibrary', 'ui.library'],
    ['androidDownload', 'ui.downloads']
  ] as const
  const { title, artist } = songAt(lyricAlbumIndex)
  return `<div class="screen screen-home">
    ${androidStatus()}
    <div class="sh-head"><h3>${t('ui.greeting')}</h3>${icon('gear')}</div>
    <ul class="sh-grid">
      <li><span class="sh-favorite">${icon('heartFilled')}</span><b>${t('ui.favorites')}</b></li>
      ${tiles}
    </ul>
    <div class="sh-section"><h3>${t('ui.suggestions')}</h3>${icon('refresh')}</div>
    <ul class="sh-rail sh-suggestions">${suggestions}</ul>
    <div class="sh-section"><h3>${t('ui.releases')}</h3></div>
    <ul class="sh-rail sh-releases">${releases}</ul>
    <div class="mini" style="${dominantStyle(lyricAlbumIndex)}">
      ${realCover(lyricAlbumIndex, '', 'small')}
      <div class="device-meta-text"><b>${escapeHtml(title)}</b><span>${escapeHtml(artist)}</span></div>
      ${icon('play')}${icon('next')}${progress(.22)}
    </div>
    <div class="tabs">${tabs.map(([name, label], i) => `<div class="${i === 0 ? 'on' : ''}"><span>${icon(name)}</span>${t(label)}</div>`).join('')}</div>
    ${gestureBar}
  </div>`
}

function playerHeader(t: Translate, mode: 'cover' | 'lyrics') {
  return `${androidStatus()}
    <div class="sp-head">${icon('chevronDown')}<p>${t('ui.nowPlaying')}</p>${icon('more', 'sp-more')}</div>
    <div class="sp-tabs">${(['cover', 'lyrics', 'queue'] as const).map(tab =>
      `<span class="${tab === mode ? 'on' : ''}">${t(`ui.${tab}`)}</span>`).join('')}</div>`
}

export function screenPlayer(t: Translate, index = lyricAlbumIndex) {
  return `<div class="screen screen-player no-gl" style="${paletteStyle(index)}">
    ${ambient(index)}${playerHeader(t, 'cover')}
    <div class="sp-core">${motionCover(index, 'sp-cover')}${metadata(index, true)}</div>
    <div class="sp-footer">${seek(14, songAt(index).duration)}${controls()}</div>
    ${gestureBar}
  </div>`
}

export function screenLyrics(t: Translate, index = lyricAlbumIndex) {
  return `<div class="screen screen-lyrics no-gl" style="${paletteStyle(index)}">
    ${ambient(index)}${playerHeader(t, 'lyrics')}
    <div class="sl-lines"><div class="sl-track">${lyricLines()}</div></div>
    ${metadata(index, true, true)}
    <div class="sp-footer">${seek(28, songAt(index).duration)}${controls()}</div>
    ${gestureBar}
  </div>`
}

export function phone(screens: string, className = '') {
  return `<div class="phone ${className}" aria-hidden="true"><div class="phone-screen">${screens}</div><span class="phone-camera"></span></div>`
}

function nextSong(t: Translate, index: number) {
  const next = songAt(index)
  return `<div class="bp-next" style="${dominantStyle(index)}">
    ${realCover(index, '', 'small')}
    <div class="bp-next-copy">
      <span>${t('ui.upNext')}</span>
      <b>${escapeHtml(next.title)}</b>
      <p>${escapeHtml(next.artist)}</p>
      <div><span>${t('ui.remaining', { seconds: '7' })}</span><span>${formatTime(next.duration)}</span></div>
    </div>
  </div>`
}

export function desktopBigPicture(t: Translate, index = lyricAlbumIndex, className = '', { nextCard = false, centered = false } = {}) {
  const { duration } = songAt(index)
  return `<div class="desk ${className}" aria-hidden="true" style="${paletteStyle(index)}">
    <div class="desk-bar"><span class="desk-title"><img src="${logo}" alt="">Openfy</span><span class="desk-win"><i></i><i></i><i></i></span></div>
    <div class="desk-body no-gl">
      ${ambient(index)}
      <div class="bp-head">${icon('chevronDown')}<div>${icon('expand')}${icon('more')}</div></div>
      <div class="bp-main${nextCard ? ' bp-with-next' : ''}${centered ? ' bp-centered' : ''}">
        <div class="bp-art"><div class="bp-artwork">${motionCover(index, 'bp-cover')}</div>${metadata(index, false)}</div>
        ${centered ? '' : `<div class="bp-lyrics"><p>${t('ui.syncedLyrics')}</p><div class="bp-lines"><div class="bp-track">${lyricLines('bp-line')}</div></div></div>`}
        ${nextCard ? nextSong(t, index + 1) : ''}
      </div>
      ${seek(nextCard ? Math.max(0, duration - 7) : 28, duration, true)}
      <div class="bp-dock">
        <div class="bp-format">${icon('headphones')}<span>AAC</span></div>
        ${controls(false)}
        <div class="bp-tools">${icon('queue')}${icon('volume')}<div class="bp-slider"><i style="--p:.24"></i></div></div>
      </div>
    </div>
  </div>`
}
