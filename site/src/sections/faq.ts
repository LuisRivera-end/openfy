import type { SectionModule } from '../types'
import { icon } from '../lib/icons'
import { CONDITIONS, EASE, gsap, ScrollTrigger } from '../lib/motion'
import './faq.css'

interface FaqItem {
  q: string
  a: string
}

export const faq: SectionModule = {
  render(t) {
    const items = t.list<FaqItem>('faq.items')
    const itemsHtml = items.map((item, index) => `
      <details class="faq-item" id="faq-item-${index + 1}">
        <summary class="faq-summary">
          <span class="faq-question">${item.q}</span>
          <span class="faq-chevron" aria-hidden="true">${icon('chevronDown')}</span>
        </summary>
        <div class="faq-answer">
          <p class="body faq-answer-text">${item.a}</p>
        </div>
      </details>
    `).join('')

    return `<section id="faq" class="faq block" aria-labelledby="faq-title">
      <div class="wrap">
        <div class="faq-head center">
          <p class="kicker">${t('faq.kicker')}</p>
          <h2 class="headline" id="faq-title">${t('faq.title')}</h2>
          <p class="lead faq-lead center">${t('faq.body')}</p>
        </div>
        <div class="faq-list">
          ${itemsHtml}
        </div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    const head = root.querySelector<HTMLElement>('.faq-head')
    const items = gsap.utils.toArray<HTMLElement>('.faq-item', root)

    mm.add(CONDITIONS, context => {
      const { motion } = context.conditions as Record<keyof typeof CONDITIONS, boolean>

      const onToggle = () => ScrollTrigger.refresh()
      root.addEventListener('toggle', onToggle, { capture: true })

      if (!motion) {
        if (head) gsap.set(head.children, { autoAlpha: 1, y: 0 })
        gsap.set(items, { autoAlpha: 1, y: 0 })
        return () => {
          root.removeEventListener('toggle', onToggle, { capture: true })
        }
      }

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top 85%',
          once: true
        }
      })

      if (head) {
        tl.from(head.children, {
          y: 28,
          autoAlpha: 0,
          duration: 0.8,
          stagger: 0.08,
          ease: EASE.out,
          clearProps: 'transform,opacity'
        })
      }

      tl.from(
        items,
        {
          y: 32,
          autoAlpha: 0,
          duration: 0.8,
          stagger: 0.06,
          ease: EASE.out,
          clearProps: 'transform,opacity'
        },
        head ? '-=0.4' : 0
      )

      return () => {
        tl.kill()
        root.removeEventListener('toggle', onToggle, { capture: true })
      }
    })
  }
}
