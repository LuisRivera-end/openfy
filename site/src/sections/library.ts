import type { SectionModule } from '../types'
import { cover, album } from '../lib/art'
import { escapeHtml } from '../lib/i18n'
import { CONDITIONS, EASE, gsap } from '../lib/motion'
import './library.css'

function renderCard(albumIndex: number, badgeText?: string): string {
  const a = album(albumIndex)
  return `<div class="library-card">
    <div class="library-art-wrap">
      ${cover(albumIndex, 'library-cover')}
      ${badgeText ? `<span class="library-badge">${escapeHtml(badgeText)}</span>` : ''}
    </div>
    <div class="library-caption">
      <h3 class="library-card-title">${escapeHtml(a.title)}</h3>
      <p class="library-card-artist">${escapeHtml(a.artist)}</p>
    </div>
  </div>`
}

export const library: SectionModule = {
  render(t) {
    const chips = t.list<string>('library.chips')
    const getChip = (index: number): string => chips[index % chips.length] ?? ''

    // Rows of fictional albums with badges showcasing mixed sources (local formats and YouTube Music)
    const row1Indices = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]
    const row2Indices = [4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7]
    const row3Indices = [2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5]

    const row1 = row1Indices.map((albumIdx, i) => {
      let badge: string | undefined
      if (i % 4 === 0) badge = getChip(0) // FLAC
      else if (i % 4 === 2) badge = getChip(3) // YouTube Music
      return renderCard(albumIdx, badge)
    }).join('')

    const row2 = row2Indices.map((albumIdx, i) => {
      let badge: string | undefined
      if (i % 3 === 0) badge = getChip(3) // YouTube Music
      else if (i % 3 === 1) badge = getChip(1) // MP3
      return renderCard(albumIdx, badge)
    }).join('')

    const row3 = row3Indices.map((albumIdx, i) => {
      let badge: string | undefined
      if (i % 4 === 1) badge = getChip(2) // AAC
      else if (i % 4 === 3) badge = getChip(3) // YouTube Music
      return renderCard(albumIdx, badge)
    }).join('')

    const lastChipIdx = Math.max(0, chips.length - 1)

    return `<section id="library" class="library block" aria-labelledby="library-title">
      <div class="wrap library-header center">
        <p class="kicker">${t('library.kicker')}</p>
        <h2 class="headline" id="library-title">${t('library.title')}</h2>
        <p class="lead">${t('library.body')}</p>
        <ul class="library-chips" aria-label="${t('library.kicker')}">
          ${chips.map((chip, idx) => `
            <li class="library-chip${idx === lastChipIdx ? ' library-chip-accent' : ''}">
              ${idx === lastChipIdx ? '<span class="chip-dot" aria-hidden="true"></span>' : ''}
              ${chip}
            </li>
          `).join('')}
        </ul>
      </div>

      <div class="library-shelves" aria-hidden="true">
        <div class="library-row library-row-1">${row1}</div>
        <div class="library-row library-row-2">${row2}</div>
        <div class="library-row library-row-3">${row3}</div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    mm.add(CONDITIONS, context => {
      const { motion, desktop } = context.conditions as Record<keyof typeof CONDITIONS, boolean>
      if (!motion) return

      // Smooth entrance reveal for the header block
      const header = root.querySelector('.library-header')
      if (header) {
        gsap.from(header.children, {
          y: 35,
          autoAlpha: 0,
          duration: 1,
          stagger: 0.1,
          ease: EASE.out,
          scrollTrigger: {
            trigger: header,
            start: 'top 85%'
          }
        })
      }

      // Scrubbed horizontal motion: rows glide in opposite directions like an endless shelf
      const row1 = root.querySelector<HTMLElement>('.library-row-1')
      const row2 = root.querySelector<HTMLElement>('.library-row-2')
      const row3 = root.querySelector<HTMLElement>('.library-row-3')

      const travel = desktop ? 18 : 8
      const scrubTl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.8
        }
      })

      if (row1) {
        scrubTl.fromTo(row1, { xPercent: 0 }, { xPercent: -travel, ease: 'none' }, 0)
      }
      if (row2) {
        scrubTl.fromTo(row2, { xPercent: -travel }, { xPercent: 0, ease: 'none' }, 0)
      }
      if (row3) {
        scrubTl.fromTo(row3, { xPercent: -2 }, { xPercent: -(travel + 4), ease: 'none' }, 0)
      }

      return () => {
        scrubTl.kill()
      }
    })
  }
}
