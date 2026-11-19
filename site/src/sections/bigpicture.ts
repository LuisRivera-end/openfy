import type { SectionModule } from '../types'
import { desktopBigPicture, lyricAlbumIndex } from '../lib/devices'
import { albumCount } from '../lib/media'
import { CONDITIONS, EASE, gsap } from '../lib/motion'
import './bigpicture.css'

export const bigPicture: SectionModule = {
  render(t) {
    const index = lyricAlbumIndex === 5 ? (lyricAlbumIndex + 1) % albumCount : 5
    return `<section id="big-picture" class="bigpic dark" aria-labelledby="bp-title">
      <div class="bigpic-stage">
        <div class="wrap bigpic-header center">
          <p class="kicker">${t('bigPicture.kicker')}</p>
          <h2 class="headline" id="bp-title">${t('bigPicture.title')}</h2>
          <p class="lead bigpic-body">${t('bigPicture.body')}</p>
        </div>
        <div class="bigpic-viewport">
          <div class="bigpic-window">
            ${desktopBigPicture(t, index, 'bp-mockup', { nextCard: true, centered: true })}
          </div>
        </div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    const header = root.querySelector<HTMLElement>('.bigpic-header')
    const windowEl = root.querySelector<HTMLElement>('.bigpic-window')
    const stage = root.querySelector<HTMLElement>('.bigpic-stage')
    const viewport = root.querySelector<HTMLElement>('.bigpic-viewport')

    // This album has no synced excerpt, so the window shows the real "docked cover" layout: the motion art and the
    // ambient background carry the movement (lib/motion-video.ts and lib/ambient-pool.ts run them while visible).
    mm.add(CONDITIONS, context => {
      const { motion, desktop } = context.conditions as Record<keyof typeof CONDITIONS, boolean>
      if (!header || !windowEl || !motion) return

      if (desktop) {
        const initialY = () => {
          if (!stage || !viewport) return 0
          return (stage.clientHeight / 2) - (viewport.offsetTop + viewport.clientHeight / 2)
        }

        gsap.set(windowEl, { scale: 1.7, y: initialY, transformOrigin: 'center center' })
        gsap.set(header, { autoAlpha: 0, y: -30 })
        gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: { trigger: root, start: 'top top', end: 'bottom bottom', scrub: 0.8, invalidateOnRefresh: true }
        })
          .fromTo(windowEl, { scale: 1.7, y: initialY }, { scale: 1.0, y: 0, duration: 0.6, ease: 'power2.out' }, 0)
          .to(header, { autoAlpha: 1, y: 0, duration: 0.45, ease: EASE.out }, 0.15)
        return
      }

      gsap.timeline({ scrollTrigger: { trigger: root, start: 'top 80%', once: true } })
        .from(header.children, { y: 24, autoAlpha: 0, duration: .8, stagger: .08, ease: EASE.out })
        .from(windowEl, { scale: .92, y: 30, duration: 1, ease: EASE.out }, .2)
    })
  }
}
