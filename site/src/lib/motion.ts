import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger, SplitText)

/** Media conditions every section uses with `ctx.mm.add(CONDITIONS, context => …)`. */
export const CONDITIONS = {
  motion: '(prefers-reduced-motion: no-preference)',
  reduce: '(prefers-reduced-motion: reduce)',
  desktop: '(min-width: 768px)',
  mobile: '(max-width: 767px)'
} as const
export type Conditions = { [K in keyof typeof CONDITIONS]: boolean }

export interface MotionContext {
  /** Shared matchMedia: everything created inside `mm.add` is reverted when conditions change. */
  mm: gsap.MatchMedia
}

/** Signature easings used across the page. */
export const EASE = { out: 'expo.out', inOut: 'power3.inOut', soft: 'power2.out' } as const

let lenis: Lenis | null = null

/** Smooth scrolling (skipped with reduced motion) wired into ScrollTrigger's clock. */
export function startMotion(): MotionContext {
  const mm = gsap.matchMedia()
  mm.add(CONDITIONS.motion, () => {
    lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 })
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (time: number) => lenis?.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    return () => { gsap.ticker.remove(tick); lenis?.destroy(); lenis = null }
  })
  return { mm }
}

/** In-page anchor navigation that goes through Lenis when active. */
export function scrollToTarget(target: string) {
  const element = document.querySelector<HTMLElement>(target)
  if (!element) return
  if (lenis) lenis.scrollTo(element, { offset: -52, duration: 1.4 })
  else element.scrollIntoView({ behavior: 'auto' })
  if (!element.matches('a, button, input, [tabindex]')) element.setAttribute('tabindex', '-1')
  element.focus({ preventScroll: true })
}

export { gsap, ScrollTrigger, SplitText }
