import type { SectionModule } from '../types'
import { icon } from '../lib/icons'
import { palette, ALBUMS } from '../lib/art'
import { CONDITIONS, EASE, gsap, ScrollTrigger, SplitText } from '../lib/motion'
// The same fluid-artwork renderer the player uses (GLSL twin of the native Direct3D shader).
import { createAmbientRenderer, type AmbientRenderer } from '../../../app/lib/ambient-gl'
import { ambientPaletteTexture } from '../../../shared/utils/ambient'
import './hero.css'

const BARS = 28
let renderer: AmbientRenderer | null = null

export const hero: SectionModule = {
  render: t => `<section class="hero dark" id="top" aria-labelledby="hero-title">
    <canvas class="hero-canvas" aria-hidden="true"></canvas>
    <div class="hero-fallback ambient-css" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="hero-shade" aria-hidden="true"></div>
    <div class="hero-inner wrap">
      <p class="kicker hero-eyebrow">${t('hero.eyebrow')}</p>
      <h1 class="display hero-title" id="hero-title"><span class="hero-line">${t('hero.titleLine1')}</span> <span class="hero-line">${t('hero.titleLine2')}</span></h1>
      <p class="lead hero-sub">${t('hero.subtitle')}</p>
      <div class="hero-ctas">
        <a class="btn btn-primary" href="#download">${icon('download')}${t('hero.ctaPrimary')}</a>
        <a class="btn btn-ghost" href="#how">${t('hero.ctaSecondary')}</a>
      </div>
    </div>
    <div class="hero-eq" aria-hidden="true">${Array.from({ length: BARS }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
    <a class="hero-scroll" href="#statement">${t('hero.scrollHint')}${icon('arrowDown')}</a>
  </section>`,

  animate(root, { mm }) {
    const canvas = root.querySelector<HTMLCanvasElement>('.hero-canvas')!
    const coarse = matchMedia('(pointer: coarse)').matches
    renderer = createAmbientRenderer(canvas, () => root.classList.add('no-gl'), coarse ? { maxFps: 30, motion: .7, resolution: .75 } : {})
    if (!renderer) root.classList.add('no-gl')
    let index = 0, timer = 0
    const show = (instant: boolean) => {
      const colors = palette(index)
      renderer?.setArtwork(ambientPaletteTexture(colors), instant)
      root.style.setProperty('--c1', colors[0]); root.style.setProperty('--c2', colors[1]); root.style.setProperty('--c3', colors[2])
    }
    if (renderer) { renderer.resize(); show(true) }
    const onResize = () => renderer?.resize()
    window.addEventListener('resize', onResize)

    mm.add(CONDITIONS, context => {
      const { motion, desktop } = context.conditions as Record<keyof typeof CONDITIONS, boolean>
      if (!motion) { renderer?.setActive(false); return }

      // Cycle through album palettes while the hero is on screen and the tab is visible.
      const cycle = () => { index = (index + 1) % ALBUMS.length; show(false) }
      const run = (on: boolean) => {
        renderer?.setActive(on)
        clearInterval(timer); if (on) timer = window.setInterval(cycle, 5200)
      }
      const visibility = ScrollTrigger.create({ trigger: root, start: 'top bottom', end: 'bottom top', onToggle: self => run(self.isActive && !document.hidden) })
      const onVisibility = () => run(visibility.isActive && !document.hidden)
      document.addEventListener('visibilitychange', onVisibility)

      // Entrance: words rise out of a mask, then the supporting copy follows.
      const title = root.querySelector<HTMLElement>('.hero-title')!
      const split = SplitText.create(title, { type: 'words', mask: 'words', wordsClass: 'hero-word' })
      title.classList.add('is-split')
      const intro = gsap.timeline({ defaults: { ease: EASE.out } })
      intro
        .from(root.querySelector('.hero-eyebrow'), { autoAlpha: 0, y: 20, duration: 1 }, 0.1)
        .from(split.words, { yPercent: 115, duration: 1.4, stagger: 0.08 }, 0.2)
        .from(root.querySelectorAll('.hero-sub, .hero-ctas'), { autoAlpha: 0, y: 30, duration: 1.2, stagger: 0.12 }, 0.75)
        .from(root.querySelectorAll('.hero-eq i'), { scaleY: 0, duration: 1, stagger: { each: 0.025, from: 'center' } }, 0.6)
        .from(root.querySelector('.hero-scroll'), { autoAlpha: 0, duration: 1 }, 1.3)

      // Leaving: copy recedes and the light grows, like stepping back from the stage.
      const exit = gsap.timeline({ scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: true } })
      exit
        .to(root.querySelector('.hero-inner'), { yPercent: desktop ? -18 : -10, scale: 0.92, autoAlpha: 0, ease: 'none' }, 0)
        .to(canvas, { scale: 1.15, ease: 'none' }, 0)
        .to(root.querySelector('.hero-eq'), { yPercent: 60, autoAlpha: 0, ease: 'none' }, 0)

      return () => {
        clearInterval(timer); visibility.kill(); split.revert(); title.classList.remove('is-split')
        document.removeEventListener('visibilitychange', onVisibility)
      }
    })
  }
}
