import type { SectionModule } from '../types'
import { desktopBigPicture } from '../lib/devices'
import { focusLyric } from './sequence'
import { CONDITIONS, EASE, gsap } from '../lib/motion'
import './bigpicture.css'

export const bigPicture: SectionModule = {
  render(t) {
    return `<section id="big-picture" class="bigpic dark" aria-labelledby="bp-title">
      <div class="bigpic-stage">
        <div class="wrap bigpic-header center">
          <p class="kicker">${t('bigPicture.kicker')}</p>
          <h2 class="headline" id="bp-title">${t('bigPicture.title')}</h2>
          <p class="lead bigpic-body">${t('bigPicture.body')}</p>
        </div>
        <div class="bigpic-viewport">
          <div class="bigpic-window">
            ${desktopBigPicture(t, 2, 'bp-mockup')}
          </div>
        </div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    const deskTrack = root.querySelector<HTMLElement>('.bp-track')
    const header = root.querySelector<HTMLElement>('.bigpic-header')
    const windowEl = root.querySelector<HTMLElement>('.bigpic-window')

    // Initial highlight for static view or reduced motion
    if (deskTrack?.children[2]) {
      deskTrack.children[2].classList.add('on')
    }

    mm.add(CONDITIONS, context => {
      const { motion, desktop } = context.conditions as Record<keyof typeof CONDITIONS, boolean>
      if (!deskTrack || !header || !windowEl) return

      // Reduced motion: static window and fully visible copy
      if (!motion) {
        gsap.set([header, windowEl], { autoAlpha: 1, scale: 1, y: 0 })
        focusLyric(deskTrack, 2)
        return
      }

      if (desktop) {
        // Desktop: "Zoom out to reveal" from scale ~1.7 to 1.0, lyrics rolling line by line
        const lineCount = deskTrack.children.length || 8
        const lyricProxy = { line: 0 }

        gsap.set(windowEl, { scale: 1.7, transformOrigin: 'center center' })
        gsap.set(header, { autoAlpha: 0, y: -30 })
        focusLyric(deskTrack, 0)

        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: {
            trigger: root,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.8,
            invalidateOnRefresh: true
          }
        })

        // Window zooms out from edge-to-edge to natural frame
        tl.to(windowEl, { scale: 1.0, duration: 0.6, ease: 'power2.out' }, 0)

        // Header fades in and settles above
        tl.to(header, { autoAlpha: 1, y: 0, duration: 0.45, ease: EASE.out }, 0.15)

        // Lyrics roll line by line across the timeline
        tl.to(lyricProxy, {
          line: lineCount - 1,
          duration: 0.85,
          ease: 'none',
          onUpdate: () => focusLyric(deskTrack, Math.round(lyricProxy.line))
        }, 0.1)

        return () => {
          deskTrack.style.transform = ''
        }
      } else {
        // Mobile: simple fade/scale-in of the window under the copy
        gsap.set(header, { autoAlpha: 1, y: 0 })
        focusLyric(deskTrack, 2)

        const mobileTl = gsap.timeline({
          scrollTrigger: {
            trigger: root,
            start: 'top 80%',
            once: true
          }
        })

        mobileTl
          .from(header.children, {
            y: 24,
            autoAlpha: 0,
            duration: 0.8,
            stagger: 0.08,
            ease: EASE.out
          })
          .from(windowEl, {
            scale: 0.92,
            autoAlpha: 0,
            y: 30,
            duration: 1.0,
            ease: EASE.out
          }, 0.2)

        return () => {
          deskTrack.style.transform = ''
        }
      }
    })
  }
}
