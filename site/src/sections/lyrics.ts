import type { SectionModule } from '../types'
import { lyricLines, lyricPreviewTime, setLyricTime } from '../lib/lyric-sync'
import { lyricExcerpt, realAlbum } from '../lib/media'
import { CONDITIONS, gsap, ScrollTrigger } from '../lib/motion'
import './lyrics.css'

export const lyrics: SectionModule = {
  render(t) {
    const excerpt = lyricExcerpt()
    const [c1, c2, c3] = realAlbum(excerpt.albumIndex).colors
    const credit = excerpt.attribution
      ? `<p class="lyrics-credit">${t('lyrics.credit', { song: excerpt.song, artist: excerpt.artist })}</p>`
      : ''

    return `<section id="lyrics" class="lyrics dark" aria-labelledby="lyrics-title">
      <div class="lyrics-glow" aria-hidden="true" style="--c1:${c1};--c2:${c2};--c3:${c3}">
        <div class="lyrics-glow-orb lyrics-glow-1"></div>
        <div class="lyrics-glow-orb lyrics-glow-2"></div>
        <div class="lyrics-glow-orb lyrics-glow-3"></div>
      </div>

      <div class="lyrics-sticky">
        <div class="lyrics-inner wrap">
          <div class="lyrics-intro">
            <p class="kicker">${t('lyrics.kicker')}</p>
            <h2 class="headline" id="lyrics-title">${t('lyrics.title')}</h2>
            <p class="lead">${t('lyrics.body')}</p>
          </div>

          <div class="lyrics-stage">
            <div class="lyrics-window"><div class="lyrics-track" data-anchor=".4">${lyricLines('lyrics-line')}</div></div>
            ${credit}
          </div>
        </div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    const track = root.querySelector<HTMLElement>('.lyrics-track')
    if (!track) return

    mm.add(CONDITIONS, context => {
      const { motion } = context.conditions as Record<keyof typeof CONDITIONS, boolean>
      if (!motion) {
        setLyricTime(track, lyricPreviewTime)
        return
      }

      const clock = { t: 0 }
      const update = () => setLyricTime(track, clock.t)
      const { duration } = lyricExcerpt()
      update()

      gsap.to(clock, {
        t: duration,
        ease: 'none',
        onUpdate: update,
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.5,
          invalidateOnRefresh: true
        }
      })
    })
  }
}
