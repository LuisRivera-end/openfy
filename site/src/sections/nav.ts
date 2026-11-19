import type { SectionModule } from '../types'
import { otherLangHref } from '../lib/i18n'
import { icon } from '../lib/icons'
import { CONDITIONS, ScrollTrigger } from '../lib/motion'
import logo from '../assets/openfy.svg'
import './nav.css'

export const nav: SectionModule = {
  render: t => `<header class="nav" id="nav">
    <div class="nav-inner">
      <a class="nav-brand" href="#top" aria-label="Openfy"><img src="${logo}" alt="" width="26" height="26"><span>Openfy</span></a>
      <nav class="nav-links" aria-label="${t('nav.features')}">
        <a href="#features">${t('nav.features')}</a>
        <a href="#how">${t('nav.how')}</a>
        <a href="#download">${t('nav.download')}</a>
        <a href="#faq">${t('nav.faq')}</a>
        <a href="#news">${t('nav.news')}</a>
      </nav>
      <div class="nav-actions">
        <a class="nav-lang" href="${otherLangHref}" hreflang="${t('nav.langLabel') === 'English' ? 'en' : 'es'}">${t('nav.langLabel')}</a>
        <a class="nav-cta" href="#download" aria-label="${t('nav.cta')}">${icon('download')}<span>${t('nav.cta')}</span></a>
      </div>
    </div>
  </header>`,
  animate(root, { mm }) {
    // Glass appears once the hero starts to leave; the nav hides while scrolling down and returns on scroll up.
    mm.add(CONDITIONS, () => {
      const glass = ScrollTrigger.create({ start: 40, end: 'max', toggleClass: { targets: root, className: 'is-glass' } })
      const hide = ScrollTrigger.create({
        start: () => window.innerHeight,
        end: 'max',
        onUpdate: self => root.classList.toggle('is-hidden', self.direction === 1 && !root.contains(document.activeElement)),
        onLeaveBack: () => root.classList.remove('is-hidden')
      })
      return () => { glass.kill(); hide.kill(); root.classList.remove('is-glass', 'is-hidden') }
    })
  }
}
