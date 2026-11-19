import type { SectionModule } from '../types'
import { t, locale, escapeHtml } from '../lib/i18n'
import { icon } from '../lib/icons'
import { CONDITIONS, EASE, gsap } from '../lib/motion'
import { loadRelease, formatDate, formatSize, LATEST_URL, RELEASES_URL, type ReleaseInfo } from '../lib/releases'
import './download.css'

export type Platform = 'windows' | 'android' | 'web' | null

/**
 * Detects visitor platform to provide a highlighted state on the corresponding card.
 * /Android/ -> android; iPhone/iPad/iPod or macOS with touch -> web; /Windows/ -> windows.
 */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)) return 'web'
  if (/Windows/i.test(ua)) return 'windows'
  return null
}

export const download: SectionModule = {
  render(t) {
    const platform = detectPlatform()
    const webSteps = t.list<string>('download.webSteps')

    // The detected platform comes first in the DOM, so reading, focus and visual order agree.
    const cards = {
      windows: `          <!-- Windows Card -->
          <div class="download-card download-card-windows${platform === 'windows' ? ' is-highlighted' : ''}">
            <div class="download-card-header">
              <div class="download-card-icon" aria-hidden="true">${icon('windows')}</div>
              <h3 class="download-card-title">${t('download.windowsName')}</h3>
              <p class="download-card-req">${t('download.windowsReq')}</p>
            </div>
            <p class="download-card-note">${t('download.windowsNote')}</p>
            <div class="download-card-action">
              <a class="btn btn-primary download-btn download-btn-windows" href="${LATEST_URL}" rel="noopener">
                ${icon('download')}
                <span>${t('download.windowsCta')}</span>
              </a>
              <div class="download-card-meta download-card-meta-windows" aria-live="polite"></div>
            </div>
          </div>

`,
      android: `          <!-- Android Card -->
          <div class="download-card download-card-android${platform === 'android' ? ' is-highlighted' : ''}">
            <div class="download-card-header">
              <div class="download-card-icon" aria-hidden="true">${icon('android')}</div>
              <h3 class="download-card-title">${t('download.androidName')}</h3>
              <p class="download-card-req">${t('download.androidReq')}</p>
            </div>
            <p class="download-card-note">${t('download.androidNote')}</p>
            <div class="download-card-action">
              <a class="btn btn-primary download-btn download-btn-android" href="${LATEST_URL}" rel="noopener">
                ${icon('download')}
                <span>${t('download.androidCta')}</span>
              </a>
              <div class="download-card-meta download-card-meta-android" aria-live="polite"></div>
            </div>
          </div>

`,
      web: `          <!-- iPhone / Web PWA Card -->
          <div class="download-card download-card-web${platform === 'web' ? ' is-highlighted' : ''}">
            <div class="download-card-header">
              <div class="download-card-icon" aria-hidden="true">${icon('phone')}</div>
              <h3 class="download-card-title">${t('download.webName')}</h3>
              <p class="download-card-req">${t('download.webReq')}</p>
            </div>
            <ol class="download-steps">
              ${webSteps.map((step, i) => `<li class="download-step"><span class="download-step-num" aria-hidden="true">${i + 1}</span><span class="download-step-text">${step}</span></li>`).join('')}
            </ol>
            <div class="download-card-action">
              <a class="btn btn-ghost download-btn download-btn-web" href="https://github.com/LuisRivera-end/openfy#iphone-fuera-de-casa-con-tailscale" rel="noopener" target="_blank">
                <span>${t('download.webCta')}</span>
              </a>
            </div>
          </div>
`
    }

    return `<section id="download" class="download block" aria-labelledby="download-title">
      <div class="wrap">
        <div class="download-head center">
          <p class="kicker">${t('download.kicker')}</p>
          <h2 class="headline" id="download-title">${t('download.title')}</h2>
          <p class="lead download-lead center">${t('download.body')}</p>
        </div>

        <div class="download-grid">
${(['windows', 'android', 'web'] as const).slice().sort((x, y) => Number(y === platform) - Number(x === platform)).map(id => cards[id]).join('')}
        </div>

        <div class="download-footer center">
          <a class="btn-link download-all" href="${RELEASES_URL}" rel="noopener" target="_blank">
            <span>${t('download.allReleases')}</span>
            ${icon('arrowRight')}
          </a>
        </div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    // Asynchronously resolve latest release data outside mm.add so it runs with reduced motion too.
    const unavailable = `<p class="download-unavailable">${t('download.unavailable')}</p>`
    const apply = (release: ReleaseInfo | null) => {
      if (!root.isConnected) return
      for (const id of ['windows', 'android'] as const) {
        const button = root.querySelector<HTMLAnchorElement>(`.download-btn-${id}`)
        const meta = root.querySelector<HTMLElement>(`.download-card-meta-${id}`)
        if (!button || !meta) continue
        if (!release) { meta.innerHTML = unavailable; continue }
        const asset = release[id]
        if (!asset) {
          // e.g. an Android-only release: never send someone to a page without their installer.
          button.href = RELEASES_URL
          button.querySelector('span')!.innerHTML = t('download.allReleases')
          meta.innerHTML = `<p class="download-unavailable">${t('download.missing')}</p>`
          continue
        }
        button.href = asset.url
        const checksums = release.checksums
          ? `<a class="download-checksums" href="${escapeHtml(release.checksums.url)}" rel="noopener" target="_blank">${t('download.checksums')}</a>`
          : ''
        meta.innerHTML = `
          <div class="download-meta-row">
            <span class="download-version">${t('download.latest', { version: release.version })}</span>
            <span class="download-dot" aria-hidden="true">·</span><span class="download-size">${escapeHtml(formatSize(asset.size, locale))}</span>
          </div>
          <div class="download-date">${t('download.published', { date: formatDate(release.date, locale) })}</div>
          ${checksums}`
      }
    }
    // Runs outside mm.add so it also happens with reduced motion; never blocks rendering.
    loadRelease().then(apply, () => apply(null))

    // Orchestrated motion with GSAP matchMedia
    mm.add(CONDITIONS, context => {
      const { motion, desktop } = context.conditions as Record<keyof typeof CONDITIONS, boolean>
      if (!motion) return

      const head = root.querySelector<HTMLElement>('.download-head')
      const cards = gsap.utils.toArray<HTMLElement>('.download-card', root)
      const footer = root.querySelector<HTMLElement>('.download-footer')

      // Scroll-triggered entrance choreography
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top 72%',
          once: true
        }
      })

      if (head) {
        tl.from(head, {
          y: desktop ? 36 : 20,
          autoAlpha: 0,
          duration: 0.8,
          ease: EASE.out
        })
      }

      tl.from(
        cards,
        {
          y: desktop ? 50 : 24,
          scale: desktop ? 0.96 : 0.98,
          autoAlpha: 0,
          duration: 0.9,
          stagger: 0.12,
          ease: EASE.out,
          clearProps: 'transform,opacity'
        },
        desktop && head ? '-=0.5' : 0
      )

      if (footer) {
        tl.from(
          footer,
          {
            y: 16,
            autoAlpha: 0,
            duration: 0.6,
            ease: EASE.out,
            clearProps: 'transform,opacity'
          },
          '-=0.4'
        )
      }

      // Desktop interactive hover: pointer tracking for soft radial highlight
      const cleanups: (() => void)[] = []
      if (desktop && window.matchMedia('(hover: hover)').matches) {
        cards.forEach(card => {
          let rect: DOMRect | null = null

          const onEnter = (e: PointerEvent) => {
            rect = card.getBoundingClientRect()
            card.style.setProperty('--mx', `${e.clientX - rect.left}px`)
            card.style.setProperty('--my', `${e.clientY - rect.top}px`)
            card.addEventListener('pointermove', onMove)
          }

          const onMove = (e: PointerEvent) => {
            if (!rect) rect = card.getBoundingClientRect()
            card.style.setProperty('--mx', `${e.clientX - rect.left}px`)
            card.style.setProperty('--my', `${e.clientY - rect.top}px`)
          }

          const onLeave = () => {
            card.removeEventListener('pointermove', onMove)
            rect = null
          }

          card.addEventListener('pointerenter', onEnter)
          card.addEventListener('pointerleave', onLeave)

          cleanups.push(() => {
            card.removeEventListener('pointerenter', onEnter)
            card.removeEventListener('pointerleave', onLeave)
            card.removeEventListener('pointermove', onMove)
          })
        })
      }

      return () => {
        tl.kill()
        cleanups.forEach(fn => fn())
      }
    })
  }
}
