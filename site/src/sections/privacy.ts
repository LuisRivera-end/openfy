import type { SectionModule } from '../types'
import { icon, type IconName } from '../lib/icons'
import { CONDITIONS, EASE, gsap, ScrollTrigger } from '../lib/motion'
import './privacy.css'

const CARD_ICONS: IconName[] = ['shield', 'server', 'check', 'lock']

export const privacy: SectionModule = {
  render(t) {
    const points = t.list<string>('privacy.points')
    const cardsHtml = points.map((point, i) => {
      const iconName = CARD_ICONS[i] ?? 'check'
      return `<div class="privacy-card">
        <div class="privacy-card-icon" aria-hidden="true">${icon(iconName)}</div>
        <h3 class="privacy-card-point">${point}</h3>
      </div>`
    }).join('')

    return `<section id="privacy" class="privacy block" aria-labelledby="privacy-title">
      <div class="wrap">
        <div class="privacy-header center">
          <div class="privacy-shield-wrap" aria-hidden="true">
            <div class="privacy-glow"></div>
            <div class="privacy-shield-badge">
              ${icon('shield', 'privacy-central-shield')}
            </div>
          </div>
          <p class="kicker">${t('privacy.kicker')}</p>
          <h2 class="headline" id="privacy-title">${t('privacy.title')}</h2>
          <p class="lead privacy-lead">${t('privacy.body')}</p>
        </div>
        <div class="privacy-grid">
          ${cardsHtml}
        </div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    const cards = gsap.utils.toArray<HTMLElement>('.privacy-card', root)
    const header = root.querySelector<HTMLElement>('.privacy-header')

    mm.add(CONDITIONS, context => {
      const { motion } = context.conditions as Record<keyof typeof CONDITIONS, boolean>

      // Toggle pulsing glow only when the section is visible to conserve GPU cycles
      const pulseTrigger = ScrollTrigger.create({
        trigger: root,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: self => {
          root.classList.toggle('is-in-view', self.isActive)
        }
      })

      if (!motion) {
        if (header) gsap.set(header.children, { autoAlpha: 1, y: 0 })
        gsap.set(cards, { autoAlpha: 1, y: 0 })
        return () => pulseTrigger.kill()
      }

      if (header) {
        gsap.from(header.children, {
          y: 28,
          autoAlpha: 0,
          duration: 0.9,
          stagger: 0.08,
          ease: EASE.out,
          scrollTrigger: {
            trigger: header,
            start: 'top 85%',
            once: true
          }
        })
      }

      gsap.from(cards, {
        y: 45,
        autoAlpha: 0,
        duration: 1.0,
        stagger: 0.12,
        ease: EASE.out,
        scrollTrigger: {
          trigger: root.querySelector('.privacy-grid'),
          start: 'top 85%',
          once: true
        }
      })

      return () => {
        pulseTrigger.kill()
        root.classList.remove('is-in-view')
      }
    })
  }
}
