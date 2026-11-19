import './styles/base.css'
import type { SectionModule } from './types'
import { t } from './lib/i18n'
import { CONDITIONS, startMotion, scrollToTarget, ScrollTrigger } from './lib/motion'
import { watchMotionVideos } from './lib/motion-video'
import { watchAmbient } from './lib/ambient-pool'
import { nav } from './sections/nav'
import { hero } from './sections/hero'
import { statement } from './sections/statement'
import { sequence } from './sections/sequence'
import { library } from './sections/library'
import { lyrics } from './sections/lyrics'
import { offline } from './sections/offline'
import { bigPicture } from './sections/bigpicture'
import { privacy } from './sections/privacy'
import { how } from './sections/how'
import { download } from './sections/download'
import { faq } from './sections/faq'
import { news } from './sections/news'
import { footer } from './sections/footer'

const page: SectionModule[] = [hero, statement, sequence, library, lyrics, offline, bigPicture, privacy, how, download, faq, news]

function render(module: SectionModule): [SectionModule, HTMLElement][] {
  const template = document.createElement('template')
  template.innerHTML = module.render(t).trim()
  return ([...template.content.children] as HTMLElement[]).map(root => [module, root])
}

// <main> is in the static HTML (skip link and no-JS fallback); sections replace its fallback content.
const app = document.getElementById('app')!
const main = document.getElementById('main')!
const header = render(nav), body = page.flatMap(render), end = render(footer)
app.prepend(...header.map(([, root]) => root))
main.replaceChildren(...body.map(([, root]) => root))
app.append(...end.map(([, root]) => root))
const mounted = [...header, ...body, ...end]

const ctx = startMotion()
const seen = new Set<SectionModule>()
for (const [module, root] of mounted) {
  if (seen.has(module)) continue
  seen.add(module)
  try { module.animate?.(root, ctx) } catch (error) { console.error(error) }
}
watchMotionVideos(app)
watchAmbient(app)

// In-page links go through the smooth scroller and move focus to their section.
document.addEventListener('click', event => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
  if (!link || link.hash.length < 2) return
  event.preventDefault()
  scrollToTarget(link.hash)
  history.replaceState(null, '', link.hash)
})

/*
 * Keep the reader's place when a breakpoint or the motion preference changes: matchMedia reverts pins,
 * which collapses their spacers and resets the scroll. The position is remembered as "fraction of the
 * current section" and restored after the rebuilt triggers are measured.
 */
const sections = [...main.children] as HTMLElement[]
let anchor: { section: HTMLElement; fraction: number } | null = null, rebuilding = false, pending = 0
const remember = () => {
  pending = 0
  if (rebuilding) return
  const section = sections.findLast(element => element.getBoundingClientRect().top <= 1) ?? sections[0]
  if (!section) return
  const rect = section.getBoundingClientRect()
  anchor = { section, fraction: rect.height ? -rect.top / rect.height : 0 }
}
addEventListener('scroll', () => { pending ||= requestAnimationFrame(remember) }, { passive: true })
for (const query of [...Object.values(CONDITIONS), '(min-width: 1024px)']) {
  matchMedia(query).addEventListener('change', () => {
    if (!anchor || rebuilding) return
    rebuilding = true
    const { section, fraction } = anchor
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ScrollTrigger.refresh()
      const top = section.getBoundingClientRect().top + scrollY + section.offsetHeight * fraction
      window.scrollTo(0, top)
      ScrollTrigger.update()
      rebuilding = false
    }))
  })
}

// CSS loops (equalizer, ambient blobs, progress bars) pause while their section is off screen.
const visibility = new IntersectionObserver(entries => {
  for (const entry of entries) entry.target.classList.toggle('is-offscreen', !entry.isIntersecting)
}, { rootMargin: '10% 0px' })
for (const section of sections) visibility.observe(section)

// Fonts and late layout change section heights; measure pins again once everything settled.
window.addEventListener('load', () => ScrollTrigger.refresh())
document.fonts?.ready.then(() => ScrollTrigger.refresh())
