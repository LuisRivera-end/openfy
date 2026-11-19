import type { SectionModule } from '../types'
import { otherLangHref } from '../lib/i18n'
import { icon } from '../lib/icons'
import { REPO } from '../lib/releases'
import logo from '../assets/openfy.svg'
import './footer.css'

export const footer: SectionModule = {
  render: t => `<footer class="footer" id="footer">
    <div class="wrap footer-inner">
      <div class="footer-brand"><img src="${logo}" alt="" width="40" height="40"><div><b>Openfy</b><p>${t('footer.tagline')}</p></div></div>
      <nav class="footer-links" aria-label="Openfy">
        <a href="https://github.com/${REPO}" rel="noopener">${icon('github')}${t('footer.github')}</a>
        <a href="https://github.com/${REPO}/blob/main/LICENSE" rel="noopener">${t('footer.license')}</a>
        <a href="${otherLangHref}">${t('nav.langLabel')}</a>
      </nav>
      <p class="footer-note">${t('footer.disclaimer')}</p>
      <p class="footer-note">${t('footer.media')}</p>
      <p class="footer-note">© ${new Date().getFullYear()} Openfy · ${t('footer.madeWith')}</p>
    </div>
  </footer>`
}
