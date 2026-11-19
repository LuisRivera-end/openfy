import type { Translate } from './lib/i18n'
import type { MotionContext } from './lib/motion'

/**
 * Section contract. Each file in src/sections exports one `SectionModule` and imports its own CSS.
 * - `render` returns the section HTML: one root `<section id="…">` (or `<header>`/`<footer>`), all text through `t`.
 * - `animate` runs once after the whole page is in the DOM. Create every tween/ScrollTrigger inside
 *   `ctx.mm.add(CONDITIONS, context => …)` so it is reverted on breakpoint/reduced-motion changes.
 *   With reduced motion, content must be fully visible without any animation.
 */
export interface SectionModule {
  render(t: Translate): string
  animate?(root: HTMLElement, ctx: MotionContext): void
}
