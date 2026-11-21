/**
 * Expanded-player layout, shared with the native fullscreen window (Openfy.Core/Immersive.cs).
 * Pinned by tests/fixtures/immersive-layout-contract.json.
 * - cover: centred artwork column (lyrics off)
 * - split: artwork and controls on the left, lyrics on the right (wide screens)
 * - stacked: compact header, lyrics in the middle, controls at the bottom (narrow screens)
 */
export type ImmersiveLayout = 'cover' | 'split' | 'stacked'
export const IMMERSIVE = { splitMinWidth: 900, splitMinAspect: 1.1 } as const
export const BIG_PICTURE = { idleMs: 4000, leadSeconds: 10, transitionMs: 1200, compactScale: 1.2, compactMs: 320, cardEnterMs: 320, layoutMs: 600, lyricsTop: .2, lyricsEdge: .18, sideMargin: 48, cardWidth: 420, cardHeight: 120, cornerHeight: 160, cornerMargin: 32, cornerWidth: .38, cornerMaxWidth: 640, avoidGap: 24 } as const

/** The queue is already in playback order, including shuffle. No mutation or random choice here. */
export function nextAutomaticIndex(count: number, index: number, repeat: string): number | null {
  if (count <= 0 || index < 0 || index >= count) return null
  if (repeat === 'one') return index
  if (index + 1 < count) return index + 1
  return repeat === 'all' ? 0 : null
}

export function upcomingSeconds(position: number, duration: number): number | null {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return null
  const remaining = duration - position
  return remaining >= 0 && remaining <= BIG_PICTURE.leadSeconds ? Math.ceil(remaining) : null
}

export interface NextCardBounds { x: number, y: number, width: number, height: number, scale: number }

/**
 * The "A continuación" card: above the dock while the controls are visible, and in compact (idle)
 * mode anchored to the bottom-right corner, the same layout uniformly scaled and widened.
 * When an obstacle rectangle is given (such as the centred cover column without synced lyrics),
 * the card narrows and reduces its scale if needed to maintain avoidGap clearance.
 * The card's own layout box is (width / scale) × cardHeight.
 */
export function nextCardBounds(viewportWidth: number, viewportHeight: number, contentRight: number, contentWidth: number, dockTop: number, idle: boolean, avoid: { right: number, bottom: number } | null = null): NextCardBounds {
  const { cardWidth, cardHeight, cornerHeight, cornerMargin, cornerWidth, cornerMaxWidth, avoidGap } = BIG_PICTURE
  let width: number, height: number, scale: number, x: number, y: number
  if (!idle) {
    width = Math.max(1, Math.min(cardWidth, contentWidth))
    height = cardHeight
    scale = 1
    x = contentRight - width
    y = Math.max(68, dockTop - 136)
  } else {
    width = Math.max(1, Math.min(viewportWidth - 2 * cornerMargin, Math.max(cardWidth, Math.min(cornerMaxWidth, viewportWidth * cornerWidth))))
    height = cornerHeight
    scale = cornerHeight / cardHeight
    x = viewportWidth - cornerMargin - width
    y = Math.max(68, viewportHeight - cornerMargin - cornerHeight)
  }
  if (avoid && avoid.bottom + avoidGap > y) {
    const minWidth = cardWidth * .75
    if (idle) {
      const available = viewportWidth - cornerMargin - (avoid.right + avoidGap)
      if (available >= cardWidth) {
        width = Math.min(width, available)
        x = viewportWidth - cornerMargin - width
      } else {
        scale = Math.max(1, available / minWidth)
        height = cardHeight * scale
        width = Math.max(available, minWidth)
        x = viewportWidth - cornerMargin - width
        y = Math.max(68, viewportHeight - cornerMargin - height)
      }
    } else {
      const available = contentRight - (avoid.right + avoidGap)
      width = Math.max(minWidth, Math.min(width, available))
      x = contentRight - width
    }
  }
  return { x, y, width, height, scale }
}

/**
 * Big Picture shows the lyrics column only for synced lyrics: plain text has nothing to follow, so plain,
 * instrumental, not found and a failed load leave the centred cover. While a load is pending the current
 * choice is kept, so a song change does not bounce between layouts.
 */
export function bigPictureLyrics(status: string | null, pending: boolean, previous: boolean): boolean {
  if (status === 'synced') return true
  if (status === null && pending) return previous
  return false
}

export function immersiveLayout(width: number, height: number, lyrics: boolean): ImmersiveLayout {
  if (!lyrics) return 'cover'
  return width >= IMMERSIVE.splitMinWidth && height > 0 && width / height >= IMMERSIVE.splitMinAspect ? 'split' : 'stacked'
}
