import { cover, album } from './art'
import { icon } from './icons'
import type { Translate } from './i18n'
import '../styles/devices.css'
import logo from '../assets/openfy.svg'

/**
 * Device mockups drawn in HTML so they stay crisp, animate, and show only generated content.
 * All sizes inside a device use container units (cqw), so a mockup scales as one piece.
 */

const statusBar = () => `<div class="status"><span>9:41</span><span class="status-icons"><i></i><i></i><b></b></span></div>`

const progress = (value: number) =>
  `<div class="progress"><div class="progress-fill" style="--p:${value}"></div></div>`

const controls = (playing = true) =>
  `<div class="controls">${icon('shuffle', 'ctl-sm')}${icon('prev')}<span class="ctl-play">${icon(playing ? 'pause' : 'play')}</span>${icon('next')}${icon('repeat', 'ctl-sm')}</div>`

export function screenHome(t: Translate) {
  const tiles = [0, 1, 2, 3, 4, 5].map(i => `<li>${cover(i)}<b>${album(i).title}</b><span>${album(i).artist}</span></li>`).join('')
  return `<div class="screen screen-home">${statusBar()}
    <div class="sh-head"><span class="sh-logo"><img src="${logo}" alt=""></span><b>Openfy</b></div>
    <p class="sh-eyebrow">${t('ui.greeting')}</p><h3 class="sh-title">${t('ui.home')}</h3>
    <div class="sh-stats"><div><b>1.284</b><span>${t('ui.minutes')}</span></div><div><b>312</b><span>${t('ui.plays')}</span></div></div>
    <p class="sh-section">${t('ui.recent')}</p>
    <ul class="sh-grid">${tiles}</ul>
    <div class="mini">${cover(3)}<div class="mini-meta"><b>${album(3).title}</b><span>${album(3).artist}</span></div>${icon('pause')}</div>
    <nav class="tabs">${icon('home', 'on')}${icon('search')}${icon('library')}${icon('download')}</nav>
  </div>`
}

export function screenPlayer(t: Translate, index = 3) {
  const a = album(index)
  return `<div class="screen screen-player" style="--c1:${a.colors[0]};--c2:${a.colors[1]};--c3:${a.colors[2]}">
    <div class="ambient-css" aria-hidden="true"><i></i><i></i><i></i></div>${statusBar()}
    <p class="sp-now">${t('ui.nowPlaying')}</p>
    <div class="sp-tabs"><b>${t('ui.cover')}</b><span>${t('ui.lyrics')}</span><span>${t('ui.queue')}</span></div>
    ${cover(index, 'sp-cover')}
    <div class="sp-meta"><div><b>${a.title}</b><span>${a.artist}</span></div>${icon('heart')}</div>
    ${progress(0.42)}<div class="sp-times"><span>1:38</span><span>3:52</span></div>
    ${controls()}
  </div>`
}

export function lyricLines(t: Translate, className = 'lyric') {
  return t.list('lyrics.sample').map((line, i) => `<p class="${className}" data-i="${i}">${line}</p>`).join('')
}

export function screenLyrics(t: Translate, index = 3) {
  const a = album(index)
  return `<div class="screen screen-lyrics" style="--c1:${a.colors[0]};--c2:${a.colors[1]};--c3:${a.colors[2]}">
    <div class="ambient-css" aria-hidden="true"><i></i><i></i><i></i></div>${statusBar()}
    <div class="sl-head">${cover(index)}<div class="sl-meta"><b>${a.title}</b><span>${a.artist}</span></div></div>
    <div class="sl-lines"><div class="sl-track">${lyricLines(t)}</div></div>
    ${progress(0.55)}${controls()}
  </div>`
}

export function phone(screens: string, className = '') {
  return `<div class="phone ${className}" aria-hidden="true"><div class="phone-screen">${screens}</div><span class="phone-island"></span></div>`
}

/** Windows Big Picture: artwork and title on the left, synced lyrics on the right, transport at the bottom. */
export function desktopBigPicture(t: Translate, index = 0, className = '') {
  const a = album(index)
  return `<div class="desk ${className}" aria-hidden="true" style="--c1:${a.colors[0]};--c2:${a.colors[1]};--c3:${a.colors[2]}">
    <div class="desk-bar"><span class="desk-title"><img src="${logo}" alt="">Openfy</span><span class="desk-win"><i></i><i></i><i></i></span></div>
    <div class="desk-body">
      <div class="ambient-css" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="bp-art">${cover(index, 'bp-cover')}<b>${a.title}</b><span>${a.artist}</span></div>
      <div class="bp-lines"><div class="bp-track">${lyricLines(t, 'bp-line')}</div></div>
      <div class="bp-bar"><span>2:04</span>${progress(0.5)}<span>4:11</span>${controls()}</div>
    </div>
  </div>`
}
