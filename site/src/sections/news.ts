import type { SectionModule } from '../types'
import { escapeHtml, locale } from '../lib/i18n'
import { icon } from '../lib/icons'
import { RELEASES_URL } from '../lib/releases'
import { CONDITIONS, EASE, gsap } from '../lib/motion'
// The same "Novedades" the apps show (Spanish text, newest first).
import notes from '../../../shared/release-notes.json'
import './news.css'

interface Note { version: string; date: string; summary?: string; items: { type: 'new' | 'improved' | 'fixed'; text: string }[] }

const formatDay = (day: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'))

export const news: SectionModule = {
  render(t) {
    const label = { new: t('news.typeNew'), improved: t('news.typeImproved'), fixed: t('news.typeFixed') }
    const releases = (notes.releases as Note[]).slice(0, 3)
    const note = t('news.spanishOnly')
    return `<section class="news block" id="news" aria-labelledby="news-title">
      <div class="wrap">
        <p class="kicker">${t('news.kicker')}</p>
        <h2 class="headline" id="news-title">${t('news.title')}</h2>
        ${note ? `<p class="body news-note">${note}</p>` : ''}
        <ol class="news-list">${releases.map(release => `<li class="news-item">
          <div class="news-meta"><b>${escapeHtml(release.version)}</b><time datetime="${escapeHtml(release.date)}">${formatDay(release.date)}</time></div>
          <div class="news-body" lang="es">
            ${release.summary ? `<p class="news-summary">${escapeHtml(release.summary)}</p>` : ''}
            <ul>${release.items.slice(0, 3).map(item => `<li><span class="tag tag-${item.type}">${label[item.type]}</span>${escapeHtml(item.text)}</li>`).join('')}</ul>
          </div></li>`).join('')}
        </ol>
        <a class="btn-link news-more" href="${RELEASES_URL}" rel="noopener">${t('news.more')} ${icon('arrowRight')}</a>
      </div>
    </section>`
  },
  animate(root, { mm }) {
    mm.add(CONDITIONS, context => {
      if (!context.conditions?.motion) return
      gsap.from(root.querySelectorAll('.news-item'), {
        y: 60, autoAlpha: 0, duration: 1.1, ease: EASE.out, stagger: 0.12,
        scrollTrigger: { trigger: root.querySelector('.news-list'), start: 'top 82%' }
      })
    })
  }
}
