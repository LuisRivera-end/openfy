import type { SectionModule } from '../types'
import { icon } from '../lib/icons'
import { CONDITIONS, EASE, gsap } from '../lib/motion'
import './how.css'

export const how: SectionModule = {
  render(t) {
    return `<section id="how" class="how block" aria-labelledby="how-title">
      <div class="wrap">
        <div class="how-header center">
          <p class="kicker">${t('how.kicker')}</p>
          <h2 class="headline" id="how-title">${t('how.title')}</h2>
          <p class="lead how-lead">${t('how.body')}</p>
        </div>

        <!-- Desktop horizontal architecture diagram -->
        <div class="how-diagram how-desktop" aria-label="${t('how.kicker')}">
          <div class="how-track-wrap" aria-hidden="true">
            <svg class="how-svg-canvas" viewBox="0 0 1000 80" preserveAspectRatio="none">
              <!-- Guide line for the tunnel -->
              <path class="how-line-base" d="M 125 40 L 625 40" />
              <!-- Animated tunnel stroke -->
              <path class="how-line-active" id="how-desk-tunnel" d="M 125 40 L 625 40" />
              <!-- Travelling packet dot -->
              <circle class="how-packet" id="how-desk-packet" cx="125" cy="40" r="5" fill="#1ed760" />
              <!-- Dashed optional-sync line to Android -->
              <path class="how-line-dashed" d="M 625 40 L 875 40" />
            </svg>

            <div class="how-badges-row">
              <div class="how-badge-col">
                <div class="how-badge">${icon('phone')}</div>
              </div>
              <div class="how-badge-col">
                <div class="how-badge">${icon('lock')}</div>
              </div>
              <div class="how-badge-col">
                <div class="how-badge is-pc">
                  ${icon('laptop')}
                  <span class="how-host-tag">${t('how.hostTag')}</span>
                </div>
              </div>
              <div class="how-badge-col">
                <div class="how-badge">${icon('android')}</div>
              </div>
            </div>
          </div>

          <div class="how-cards-row">
            <div class="how-card-col">
              <div class="how-card">
                <h3 class="how-card-title">${t('how.phone')}</h3>
                <p class="body how-card-body">${t('how.phoneCaption')}</p>
              </div>
            </div>
            <div class="how-card-col">
              <div class="how-card">
                <h3 class="how-card-title">${t('how.tailscale')}</h3>
                <p class="body how-card-body">${t('how.tailscaleCaption')}</p>
              </div>
            </div>
            <div class="how-card-col">
              <div class="how-card is-pc">
                <h3 class="how-card-title">${t('how.pc')}</h3>
                <p class="body how-card-body">${t('how.pcCaption')}</p>
              </div>
            </div>
            <div class="how-card-col">
              <div class="how-card">
                <h3 class="how-card-title">${t('how.android')}</h3>
                <p class="body how-card-body">${t('how.androidCaption')}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile vertical architecture stack -->
        <div class="how-diagram how-mobile" aria-label="${t('how.kicker')}">
          <!-- 1: iPhone -->
          <div class="how-m-node">
            <div class="how-m-card">
              <div class="how-m-badge">${icon('phone')}</div>
              <div class="how-m-content">
                <h3 class="how-card-title">${t('how.phone')}</h3>
                <p class="body how-card-body">${t('how.phoneCaption')}</p>
              </div>
            </div>
          </div>

          <!-- Connector: Phone to Tailscale -->
          <div class="how-m-connector" aria-hidden="true">
            <svg viewBox="0 0 24 54" class="how-m-svg">
              <path class="how-line-base" d="M 12 0 L 12 54" />
              <path class="how-line-active how-m-tunnel-1" d="M 12 0 L 12 54" />
              <circle class="how-packet how-m-packet-1" cx="12" cy="0" r="4" fill="#1ed760" />
            </svg>
          </div>

          <!-- 2: Tailscale -->
          <div class="how-m-node">
            <div class="how-m-card">
              <div class="how-m-badge">${icon('lock')}</div>
              <div class="how-m-content">
                <h3 class="how-card-title">${t('how.tailscale')}</h3>
                <p class="body how-card-body">${t('how.tailscaleCaption')}</p>
              </div>
            </div>
          </div>

          <!-- Connector: Tailscale to PC -->
          <div class="how-m-connector" aria-hidden="true">
            <svg viewBox="0 0 24 54" class="how-m-svg">
              <path class="how-line-base" d="M 12 0 L 12 54" />
              <path class="how-line-active how-m-tunnel-2" d="M 12 0 L 12 54" />
              <circle class="how-packet how-m-packet-2" cx="12" cy="0" r="4" fill="#1ed760" />
            </svg>
          </div>

          <!-- 3: Windows PC (Host) -->
          <div class="how-m-node">
            <div class="how-m-card is-pc">
              <div class="how-m-badge is-pc">
                ${icon('laptop')}
                <span class="how-host-tag">${t('how.hostTag')}</span>
              </div>
              <div class="how-m-content">
                <h3 class="how-card-title">${t('how.pc')}</h3>
                <p class="body how-card-body">${t('how.pcCaption')}</p>
              </div>
            </div>
          </div>

          <!-- Connector: PC to Android (dashed sync) -->
          <div class="how-m-connector" aria-hidden="true">
            <svg viewBox="0 0 24 54" class="how-m-svg">
              <path class="how-line-dashed" d="M 12 0 L 12 54" />
            </svg>
          </div>

          <!-- 4: Android -->
          <div class="how-m-node">
            <div class="how-m-card">
              <div class="how-m-badge">${icon('android')}</div>
              <div class="how-m-content">
                <h3 class="how-card-title">${t('how.android')}</h3>
                <p class="body how-card-body">${t('how.androidCaption')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>`
  },

  animate(root, { mm }) {
    const header = root.querySelector<HTMLElement>('.how-header')

    // The horizontal diagram needs room for four columns; tablets use the stacked layout.
    mm.add({ ...CONDITIONS, wide: '(min-width: 1024px)' }, context => {
      const { motion, wide: desktop } = context.conditions as Record<keyof typeof CONDITIONS | 'wide', boolean>

      if (!motion) {
        if (header) gsap.set(header.children, { autoAlpha: 1, y: 0 })
        const tunnelPath = root.querySelector<SVGPathElement>('#how-desk-tunnel')
        const tunnel1 = root.querySelector<SVGPathElement>('.how-m-tunnel-1')
        const tunnel2 = root.querySelector<SVGPathElement>('.how-m-tunnel-2')
        const packets = root.querySelectorAll<SVGCircleElement>('.how-packet')
        if (tunnelPath) gsap.set(tunnelPath, { strokeDashoffset: 0 })
        if (tunnel1) gsap.set(tunnel1, { strokeDashoffset: 0 })
        if (tunnel2) gsap.set(tunnel2, { strokeDashoffset: 0 })
        gsap.set(packets, { autoAlpha: 0 })
        gsap.set(root.querySelectorAll('.how-card, .how-badge, .how-m-node'), { autoAlpha: 1, y: 0 })
        return
      }

      // Animate header entry
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

      if (desktop) {
        const tunnelPath = root.querySelector<SVGPathElement>('#how-desk-tunnel')
        const packet = root.querySelector<SVGCircleElement>('#how-desk-packet')
        const cols = gsap.utils.toArray<HTMLElement>('.how-cards-row .how-card', root)
        // Badges sit on the connector line, so they only fade (moving them would detach the line).
        gsap.from(root.querySelectorAll('.how-badges-row .how-badge'), { autoAlpha: 0, duration: 0.6, stagger: 0.08, scrollTrigger: { trigger: root.querySelector('.how-desktop'), start: 'top 82%', once: true } })

        if (tunnelPath && packet) {
          const length = tunnelPath.getTotalLength() || 500
          gsap.set(tunnelPath, { strokeDasharray: length, strokeDashoffset: length })
          gsap.set(packet, { attr: { cx: 125 }, autoAlpha: 0 })

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: root.querySelector('.how-desktop'),
              start: 'top 82%',
              end: 'top 32%',
              scrub: 0.8
            }
          })

          tl.from(cols, {
            y: 28,
            autoAlpha: 0,
            duration: 0.8,
            stagger: 0.08,
            ease: EASE.out
          }, 0)

          tl.to(tunnelPath, {
            strokeDashoffset: 0,
            ease: 'none',
            duration: 1
          }, 0.05)

          tl.fromTo(packet,
            { attr: { cx: 125 }, autoAlpha: 0 },
            { attr: { cx: 625 }, autoAlpha: 1, ease: 'none', duration: 1 },
            0.05
          )
        }
      } else {
        const tunnel1 = root.querySelector<SVGPathElement>('.how-m-tunnel-1')
        const tunnel2 = root.querySelector<SVGPathElement>('.how-m-tunnel-2')
        const packet1 = root.querySelector<SVGCircleElement>('.how-m-packet-1')
        const packet2 = root.querySelector<SVGCircleElement>('.how-m-packet-2')
        const mNodes = gsap.utils.toArray<HTMLElement>('.how-m-node', root)

        const l1 = tunnel1?.getTotalLength() || 54
        const l2 = tunnel2?.getTotalLength() || 54
        if (tunnel1) gsap.set(tunnel1, { strokeDasharray: l1, strokeDashoffset: l1 })
        if (tunnel2) gsap.set(tunnel2, { strokeDasharray: l2, strokeDashoffset: l2 })
        if (packet1) gsap.set(packet1, { attr: { cy: 0 }, autoAlpha: 0 })
        if (packet2) gsap.set(packet2, { attr: { cy: 0 }, autoAlpha: 0 })

        const mTl = gsap.timeline({
          scrollTrigger: {
            trigger: root.querySelector('.how-mobile'),
            start: 'top 85%',
            end: 'bottom 85%',
            scrub: 0.8
          }
        })

        mTl.from(mNodes, {
          y: 24,
          autoAlpha: 0,
          duration: 0.6,
          stagger: 0.15,
          ease: EASE.out
        }, 0)

        if (tunnel1 && packet1) {
          mTl.to(tunnel1, { strokeDashoffset: 0, duration: 0.45, ease: 'none' }, 0.1)
          mTl.fromTo(packet1,
            { attr: { cy: 0 }, autoAlpha: 0 },
            { attr: { cy: 54 }, autoAlpha: 1, duration: 0.45, ease: 'none' },
            0.1
          )
        }

        if (tunnel2 && packet2) {
          mTl.to(tunnel2, { strokeDashoffset: 0, duration: 0.45, ease: 'none' }, 0.45)
          mTl.fromTo(packet2,
            { attr: { cy: 0 }, autoAlpha: 0 },
            { attr: { cy: 54 }, autoAlpha: 1, duration: 0.45, ease: 'none' },
            0.45
          )
        }
      }
    })
  }
}
