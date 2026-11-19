import type { SectionModule } from '../types'
import { album } from '../lib/art'
import { CONDITIONS, gsap, ScrollTrigger } from '../lib/motion'
import './lyrics.css'

export const lyrics: SectionModule = {
  render(t) {
    const lines = t.list<string>('lyrics.sample')
    const colors = album(1).colors

    return `<section id="lyrics" class="lyrics dark" aria-labelledby="lyrics-title">
      <div class="lyrics-glow" aria-hidden="true" style="--c1:${colors[0]};--c2:${colors[1]};--c3:${colors[2]}">
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
            <div class="lyrics-track" role="list">
              ${lines.map((line, i) => `<p class="lyrics-line" role="listitem" data-line="${i}">${line}</p>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    mm.add(CONDITIONS, context => {
      const { motion } = context.conditions as Record<keyof typeof CONDITIONS, boolean>
      const track = root.querySelector<HTMLElement>('.lyrics-track')
      const stage = root.querySelector<HTMLElement>('.lyrics-stage')
      const lineElements = gsap.utils.toArray<HTMLElement>('.lyrics-line', root)

      if (!motion) {
        // Plain list at full opacity under reduced motion
        lineElements.forEach(line => line.classList.add('is-static'))
        return () => lineElements.forEach(line => line.classList.remove('is-static'))
      }

      if (!track || !stage || lineElements.length === 0) return

      // Pause ambient animations when offscreen
      const visibility = ScrollTrigger.create({
        trigger: root,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: self => {
          root.classList.toggle('is-visible', self.isActive)
        }
      })

      // Updates active highlight and translates track so active line sits near 40% of viewport height
      // Geometry is measured once per refresh, not on every scrubbed frame.
      let targetOffset = 0, tops: number[] = [], lastActive = -1
      const measure = () => {
        targetOffset = (stage.clientHeight || window.innerHeight) * 0.40
        tops = lineElements.map(line => line.offsetTop)
        lastActive = -1
      }
      measure()
      const updatePosition = (progress: number) => {

        const p = Math.max(0, Math.min(1, progress)) * (lineElements.length - 1)
        const i0 = Math.floor(p)
        const i1 = Math.min(lineElements.length - 1, i0 + 1)
        const frac = p - i0

        const t0 = tops[i0], t1 = tops[i1]
        if (t0 === undefined || t1 === undefined) return

        const y0 = targetOffset - t0
        const y1 = targetOffset - t1
        const currentY = y0 + (y1 - y0) * frac

        track.style.transform = `translate3d(0, ${currentY}px, 0)`

        const activeIdx = Math.min(lineElements.length - 1, Math.max(0, Math.round(p)))
        if (activeIdx === lastActive) return
        lastActive = activeIdx
        lineElements.forEach((line, i) => {
          line.classList.toggle('is-active', i === activeIdx)
          line.classList.toggle('is-past', i < activeIdx)
          line.classList.toggle('is-future', i > activeIdx)
        })
      }

      // Initial position for line 0
      updatePosition(0)

      const proxy = { progress: 0 }
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.5,
          invalidateOnRefresh: true
        }
      })

      // Follow the scrubbed (smoothed) value, not the raw scroll position.
      tl.to(proxy, { progress: 1, ease: 'none', onUpdate: () => updatePosition(proxy.progress) })

      const onRefresh = () => { measure(); updatePosition(proxy.progress) }
      ScrollTrigger.addEventListener('refresh', onRefresh)

      return () => {
        visibility.kill()
        tl.kill()
        ScrollTrigger.removeEventListener('refresh', onRefresh)
      }
    })
  }
}
