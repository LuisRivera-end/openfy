import type { SectionModule } from '../types'
import { phone } from '../lib/devices'
import { cover, album } from '../lib/art'
import { escapeHtml } from '../lib/i18n'
import { CONDITIONS, EASE, gsap } from '../lib/motion'
import './offline.css'

function screenDownloads(kicker: string, title: string, stat1: string, stat2: string): string {
  const items = [0, 1, 2, 4, 5, 6].map(i => {
    const a = album(i)
    return `<li class="od-item">
      ${cover(i, 'od-cover')}
      <div class="od-meta">
        <b>${escapeHtml(a.title)}</b>
        <span>${escapeHtml(a.artist)}</span>
      </div>
      <div class="od-status" aria-hidden="true">
        <svg class="od-ring-svg" viewBox="0 0 36 36">
          <circle class="od-ring-track" cx="18" cy="18" r="14" fill="none" stroke="currentColor" stroke-width="3"/>
          <circle class="od-ring-fill" cx="18" cy="18" r="14" fill="none" stroke="var(--green)" stroke-width="3" stroke-dasharray="88" stroke-dashoffset="88" transform="rotate(-90 18 18)"/>
          <path class="od-check-path" d="M11 18.5 L15.5 23 L25 13.5" fill="none" stroke="var(--green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="24" stroke-dashoffset="24"/>
        </svg>
      </div>
    </li>`
  }).join('')

  return `<div class="screen screen-downloads">
    <div class="status">
      <span>9:41</span>
      <span class="status-icons">
        <svg class="offline-airplane" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
        </svg>
        <i></i><i></i><b></b>
      </span>
    </div>

    <div class="od-screen-body">
      <div class="od-head">
        <div>
          <p class="od-eyebrow">${kicker}</p>
          <p class="od-title">${title}</p>
        </div>
        <span class="od-verified-badge">${stat1}</span>
      </div>

      <ul class="od-list">${items}</ul>

      <div class="od-footer">
        <div class="od-footer-info">
          <span>100% · SHA-256 OK</span>
          <span>${stat2}</span>
        </div>
        <div class="od-storage-bar"><div class="od-storage-fill"></div></div>
      </div>
    </div>
  </div>`
}

export const offline: SectionModule = {
  render(t) {
    const kicker = t('offline.kicker')
    const title = t('offline.title')
    const body = t('offline.body')

    const stat1Val = t('offline.stat1Value')
    const stat1Lbl = t('offline.stat1Label')
    const stat2Val = t('offline.stat2Value')
    const stat2Lbl = t('offline.stat2Label')
    const stat3Val = t('offline.stat3Value')
    const stat3Lbl = t('offline.stat3Label')

    const phoneMockup = phone(screenDownloads(kicker, t('ui.downloads'), stat1Val, stat2Val), 'offline-phone')

    return `<section id="offline" class="offline block" aria-labelledby="offline-title">
      <div class="wrap">
        <div class="offline-grid">
          <div class="offline-copy">
            <p class="kicker">${kicker}</p>
            <h2 class="headline" id="offline-title">${title}</h2>
            <p class="lead">${body}</p>
          </div>
          <div class="offline-mockup" aria-hidden="true">
            ${phoneMockup}
          </div>
        </div>

        <div class="offline-stats">
          <div class="offline-stat">
            <p class="offline-stat-val">${stat1Val}</p>
            <h3 class="offline-stat-lbl">${stat1Lbl}</h3>
          </div>
          <div class="offline-stat">
            <p class="offline-stat-val">${stat2Val}</p>
            <h3 class="offline-stat-lbl">${stat2Lbl}</h3>
          </div>
          <div class="offline-stat">
            <p class="offline-stat-val">${stat3Val}</p>
            <h3 class="offline-stat-lbl">${stat3Lbl}</h3>
          </div>
        </div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    mm.add(CONDITIONS, context => {
      const { motion, desktop } = context.conditions as Record<keyof typeof CONDITIONS, boolean>
      const rings = root.querySelectorAll<SVGCircleElement>('.od-ring-fill')
      const checks = root.querySelectorAll<SVGPathElement>('.od-check-path')
      const airplane = root.querySelector<SVGElement>('.offline-airplane')
      const copyEl = root.querySelector<HTMLElement>('.offline-copy')
      const phoneEl = root.querySelector<HTMLElement>('.offline-phone')
      const statCards = root.querySelectorAll<HTMLElement>('.offline-stat')

      if (!motion) {
        rings.forEach(r => { r.style.strokeDashoffset = '0' })
        checks.forEach(c => { c.style.strokeDashoffset = '0' })
        if (airplane) airplane.classList.add('is-active')
        return
      }

      // Entrance animation for copy, phone, and download progress rings
      const tl = gsap.timeline({
        defaults: { ease: EASE.out },
        scrollTrigger: {
          trigger: root,
          start: 'top 75%',
          once: true
        }
      })

      if (copyEl) {
        tl.from(copyEl.children, {
          y: 30,
          autoAlpha: 0,
          duration: 1,
          stagger: 0.12
        }, 0)
      }

      if (phoneEl) {
        tl.from(phoneEl, {
          y: desktop ? 45 : 25,
          scale: 0.96,
          autoAlpha: 0,
          duration: 1.2
        }, 0.1)
      }

      // Staggered progress rings completion followed by checkmark drawing
      rings.forEach((ring, idx) => {
        const check = checks[idx]
        const at = 0.35 + idx * 0.28

        tl.to(ring, {
          strokeDashoffset: 0,
          duration: 0.7,
          ease: 'power2.out'
        }, at)

        if (check) {
          tl.to(check, {
            strokeDashoffset: 0,
            duration: 0.35,
            ease: EASE.out
          }, at + 0.45)
        }
      })

      // Airplane mode activates in the status bar once all downloads are verified
      if (airplane) {
        tl.to(airplane, {
          opacity: 1,
          scale: 1,
          color: 'var(--green)',
          duration: 0.45,
          ease: EASE.soft,
          onStart: () => airplane.classList.add('is-active')
        }, '+=0.1')
      }

      // Reveal stats with stagger
      const statsTl = gsap.timeline({
        scrollTrigger: {
          trigger: root.querySelector('.offline-stats') ?? root,
          start: 'top 85%',
          once: true
        }
      })

      statsTl.from(statCards, {
        y: 35,
        autoAlpha: 0,
        duration: 0.9,
        stagger: 0.12,
        ease: EASE.out
      })

      // Only animate numerically if the value is a plain number
      statCards.forEach(card => {
        const valEl = card.querySelector<HTMLElement>('.offline-stat-val')
        if (!valEl) return
        const text = valEl.textContent?.trim() ?? ''
        if (/^\d+$/.test(text)) {
          const target = parseInt(text, 10)
          const obj = { val: 0 }
          valEl.textContent = '0'
          statsTl.to(obj, {
            val: target,
            duration: 0.8,
            ease: EASE.out,
            onUpdate: () => {
              valEl.textContent = Math.round(obj.val).toString()
            }
          }, 0.2)
        }
      })

      return () => {
        tl.kill()
        statsTl.kill()
      }
    })
  }
}
