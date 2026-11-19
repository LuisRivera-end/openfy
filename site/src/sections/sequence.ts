import type { SectionModule } from '../types'
import { phone, screenHome, screenPlayer, screenLyrics, desktopBigPicture } from '../lib/devices'
import { CONDITIONS, EASE, gsap } from '../lib/motion'
import './sequence.css'

interface Step { kicker: string; title: string; body: string }

/**
 * Moves a lyric track so line `index` sits at the reading position (`anchor` × the visible height of
 * the track's parent) and highlights it; earlier lines are marked `past`.
 */
export function focusLyric(track: HTMLElement, index: number, anchor = 0.34) {
  const lines = [...track.children] as HTMLElement[]
  const active = Math.max(0, Math.min(lines.length - 1, index))
  const line = lines[active]
  if (!line || track.dataset.active === String(active)) return
  track.dataset.active = String(active)
  lines.forEach((element, i) => { element.classList.toggle('on', i === active); element.classList.toggle('past', i < active) })
  const view = track.parentElement?.clientHeight ?? 0
  track.style.transform = `translateY(${Math.round(view * anchor - line.offsetTop - line.offsetHeight / 2)}px)`
}

export const sequence: SectionModule = {
  render(t) {
    const steps = t.list<Step>('sequence.steps')
    const shots = [phone(screenHome(t)), phone(screenPlayer(t)), phone(screenLyrics(t)), desktopBigPicture(t, 0, 'seq-shot-desk')]
    return `<section class="seq dark" id="features" aria-labelledby="seq-heading">
      <h2 class="sr-only" id="seq-heading">${t('nav.features')}</h2>
      <div class="seq-pin">
        <div class="seq-grid wrap">
          <ol class="seq-steps">${steps.map((step, i) => `<li class="seq-step" data-step="${i}">
            <p class="kicker">${step.kicker}</p><h3 class="headline">${step.title}</h3><p class="lead">${step.body}</p>
            <div class="seq-shot">${shots[i] ?? ''}</div></li>`).join('')}
          </ol>
          <div class="seq-stage" aria-hidden="true">
            <div class="seq-phone">${phone(screenHome(t) + screenPlayer(t) + screenLyrics(t))}</div>
            <div class="seq-desk">${desktopBigPicture(t, 0)}</div>
            <div class="seq-dots">${steps.map(() => '<i></i>').join('')}</div>
          </div>
        </div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    // Static layouts still show a highlighted lyric in their screenshots.
    root.querySelectorAll<HTMLElement>('.seq-shot .sl-track, .seq-shot .bp-track').forEach(track => track.children[2]?.classList.add('on'))

    mm.add(CONDITIONS, context => {
      const { motion, desktop } = context.conditions as Record<keyof typeof CONDITIONS, boolean>
      if (!motion || !desktop) return

      root.classList.add('is-pinned')
      const q = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector) as T
      const steps = gsap.utils.toArray<HTMLElement>('.seq-step', root)
      const dots = gsap.utils.toArray<HTMLElement>('.seq-dots i', root)
      const [home, player, lyrics] = gsap.utils.toArray<HTMLElement>('.seq-phone .screen', root)
      const phoneTrack = q('.seq-phone .sl-track'), deskTrack = q('.seq-desk .bp-track')
      const lineCount = phoneTrack.children.length
      let activeDot = -1
      const setDot = (index: number) => {
        if (index === activeDot) return
        activeDot = index
        dots.forEach((dot, i) => dot.classList.toggle('on', i === index))
      }

      gsap.set(steps.slice(1), { autoAlpha: 0, y: 60 })
      gsap.set(player!, { yPercent: 100 })
      gsap.set(lyrics!, { autoAlpha: 0 })
      gsap.set(q('.seq-desk'), { autoAlpha: 0, scale: 0.55, y: 120 })
      focusLyric(phoneTrack, 0); focusLyric(deskTrack, 0)
      setDot(0)

      const swap = (from: number, to: number, at: number) => tl
        .to(steps[from]!, { autoAlpha: 0, y: -60, duration: 0.35, ease: 'power2.in' }, at)
        .to(steps[to]!, { autoAlpha: 1, y: 0, duration: 0.45, ease: EASE.soft }, at + 0.3)

      const lyricProxy = { phone: 0, desk: 0 }
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: () => '+=' + window.innerHeight * 4,
          pin: q('.seq-pin'),
          scrub: 0.8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: self => setDot(Math.min(3, Math.floor(self.progress * 4.2)))
        }
      })

      // 0 → 1: Home slides away under the expanded player.
      swap(0, 1, 0.55)
      tl.to(home!, { scale: 0.9, autoAlpha: 0.3, duration: 0.6, ease: EASE.inOut }, 0.6)
        .to(player!, { yPercent: 0, duration: 0.6, ease: EASE.inOut }, 0.6)
      // 1 → 2: lyrics take over the player, then roll line by line.
      swap(1, 2, 1.55)
      tl.to(lyrics!, { autoAlpha: 1, duration: 0.4 }, 1.7)
        .to(lyricProxy, { phone: lineCount - 1, duration: 1, onUpdate: () => focusLyric(phoneTrack, Math.round(lyricProxy.phone)) }, 2)
      // 2 → 3: the phone steps back and Big Picture fills the stage.
      swap(2, 3, 2.75)
      tl.to(q('.seq-phone'), { xPercent: -70, scale: 0.6, autoAlpha: 0, duration: 0.7, ease: EASE.inOut }, 2.85)
        .to(q('.seq-desk'), { autoAlpha: 1, scale: 1, y: 0, duration: 0.8, ease: EASE.inOut }, 2.9)
        .to(lyricProxy, { desk: lineCount - 1, duration: 1.1, onUpdate: () => focusLyric(deskTrack, Math.round(lyricProxy.desk)) }, 3.3)

      return () => { root.classList.remove('is-pinned'); setDot(-1) }
    })
  }
}
