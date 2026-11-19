import type { SectionModule } from '../types'
import { CONDITIONS, gsap, SplitText } from '../lib/motion'
import './statement.css'

/** One large sentence that lights up word by word with the scroll, the way a synced lyric line does. */
export const statement: SectionModule = {
  render: t => `<section class="statement dark" id="statement">
    <div class="wrap"><p class="headline statement-text">${t('statement.line')}</p></div>
  </section>`,
  animate(root, { mm }) {
    mm.add(CONDITIONS, context => {
      if (!context.conditions?.motion) return
      const split = SplitText.create(root.querySelector('.statement-text'), { type: 'words' })
      gsap.fromTo(split.words, { opacity: 0.38 }, {
        opacity: 1, ease: 'none', stagger: 0.12,
        scrollTrigger: { trigger: root, start: 'top 70%', end: 'bottom 55%', scrub: 0.6 }
      })
      return () => split.revert()
    })
  }
}
