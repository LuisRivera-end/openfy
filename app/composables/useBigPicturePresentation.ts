import { BIG_PICTURE, nextCardBounds } from '../../shared/utils/immersive'

/** Keep the dock slots stationary: the next-song card is anchored to them, not to the enlarged scene. */
export function useBigPicturePresentation(root: Ref<HTMLDialogElement | undefined>, enabled: Ref<boolean>, idle: Ref<boolean>, hasCard: Ref<boolean>, morphing: Ref<boolean>, viewLayout: Ref<string>, slides: Ref<boolean>) {
  const appearance = useAppearanceStore()
  const animations = new Map<HTMLElement, Animation>()
  const positioned = new Set<HTMLElement>()
  let observer: ResizeObserver | undefined, queued = 0
  function place(element: HTMLElement, x: number, y: number, width: number, height: number | undefined, scale: number, animate: boolean, duration: number) {
    const before = element.getBoundingClientRect()
    animations.get(element)?.cancel()
    animations.delete(element); positioned.add(element)
    Object.assign(element.style, { position: 'fixed', left: '0px', top: '0px', width: `${width}px`, maxWidth: 'none', margin: '0', transformOrigin: '0 0', transform: `translate(${x}px, ${y}px) scale(${scale})` })
    if (height !== undefined) element.style.height = `${height}px`
    if (!animate || before.width === 0) return
    const animation = element.animate([
      { transform: `translate(${before.x}px, ${before.y}px) scale(${before.width / width})` },
      { transform: element.style.transform },
    ], { duration, easing: 'cubic-bezier(.22,1,.36,1)' })
    animations.set(element, animation)
    void animation.finished.then(() => { if (animations.get(element) === animation) animations.delete(element) }).catch(() => {})
  }
  /** `duration`: the idle change (compactMs) or the split ↔ cover slide when the lyrics column comes or goes (layoutMs). */
  function layout(animate = false, duration: number = BIG_PICTURE.compactMs) {
    const dialog = root.value
    for (const element of positioned) if (!element.isConnected) { animations.get(element)?.cancel(); animations.delete(element); positioned.delete(element) }
    if (!dialog || !enabled.value) {
      for (const element of positioned) {
        animations.get(element)?.cancel()
        for (const name of ['position', 'left', 'top', 'width', 'max-width', 'margin', 'transform-origin', 'transform', 'height']) element.style.removeProperty(name)
      }
      positioned.clear()
      return
    }
    const art = dialog.querySelector<HTMLElement>('.immersive-artwork'), info = dialog.querySelector<HTMLElement>('.immersive-info')
    const artSlot = dialog.querySelector('.immersive-artwork-slot')?.getBoundingClientRect()
    const infoSlot = dialog.querySelector('.immersive-info-slot')?.getBoundingClientRect()
    // A lyrics column fading out (lyrics-pane transition) keeps its last place.
    const lyricsSlot = dialog.querySelector('.immersive-lyrics-slot:not(.lyrics-pane-leave-active)')?.getBoundingClientRect()
    const content = dialog.querySelector('.immersive-content')?.getBoundingClientRect()
    const header = dialog.querySelector('header')?.getBoundingClientRect()
    const dockElement = dialog.querySelector<HTMLElement>('.immersive-seek')
    const dock = dockElement?.getBoundingClientRect()
    if (!art || !info || !artSlot?.width || !infoSlot || !content || !header || !dock) return
    // The dock fades down by 8px. Its reserved layout position remains the card's anchor.
    const dockTop = dock.top - new DOMMatrixReadOnly(getComputedStyle(dockElement!).transform).m42
    const split = dialog.querySelector('[data-layout="split"]') !== null
    // The docked cover (Big Picture without synced lyrics) shares the split rows: same vertical placement and idle centring.
    const column = split || dialog.querySelector('.is-docked') !== null
    const scale = idle.value ? Math.min(BIG_PICTURE.compactScale, Math.max(1, (innerHeight - header.bottom - 48) / Math.max(1, artSlot.height + infoSlot.height + 62))) : 1
    const side = artSlot.width * scale
    const x = Math.max(content.left, artSlot.x - (side - artSlot.width) / 2)
    const groupHeight = side + (infoSlot.height + 62) * scale
    const y = column && idle.value ? Math.max(header.bottom + 24, Math.min(artSlot.y, (header.bottom + 24 + innerHeight - 24 - groupHeight) / 2)) : artSlot.y
    const motion = animate && appearance.effects && !matchMedia('(prefers-reduced-motion: reduce)').matches
    place(art, x, y, artSlot.width, artSlot.height, scale, motion, duration)
    const infoY = column ? y + side + 22 * scale : infoSlot.y
    const infoX = column ? x : Math.max(content.left, infoSlot.x - infoSlot.width * (scale - 1) / 2)
    place(info, infoX, infoY, Math.min(infoSlot.width, (content.right - infoX) / scale), undefined, scale, motion, duration)
    const lyrics = dialog.querySelector<HTMLElement>('.immersive-lyrics-slot:not(.lyrics-pane-leave-active) .immersive-lyrics')
    if (lyrics && lyricsSlot) {
      // The enlarged artwork keeps the full-size gap; the lyrics shift into the empty outer margin instead of narrowing.
      const gap = Math.max(32, lyricsSlot.x - (artSlot.x + artSlot.width))
      const left = split ? Math.max(lyricsSlot.x, x + side + gap) : lyricsSlot.x
      const right = split ? Math.max(content.right, Math.min(innerWidth - BIG_PICTURE.sideMargin, content.right + left - lyricsSlot.x)) : content.right
      const top = split ? y + side * BIG_PICTURE.lyricsTop : Math.max(lyricsSlot.top, infoY + infoSlot.height * scale + 48)
      // Docked above the controls or in the compact corner, the lyrics end 16 px before the card.
      const cardTop = hasCard.value ? nextCardBounds(innerWidth, innerHeight, content.right, content.width, dockTop, idle.value).y - 16 : Infinity
      const bottom = Math.min(idle.value ? innerHeight - 24 : dockTop - 20, cardTop)
      // A column that has just appeared is placed directly; its own fade reveals it once the song has moved aside.
      place(lyrics, left, top, Math.max(1, right - left) / scale, Math.max(48, bottom - top) / scale, scale, motion && duration === BIG_PICTURE.compactMs, duration)
    }
    dialog.style.setProperty('--picture-scale', String(scale))
  }
  function schedule() { cancelAnimationFrame(queued); queued = requestAnimationFrame(() => layout()) }
  const settle = () => layout()
  watch(idle, () => { if (!morphing.value) layout(true) }, { flush: 'post' })
  watch([enabled, hasCard, morphing], () => layout(), { flush: 'post' })
  // The lyrics column coming or going slides the song between its column and the centre.
  watch(viewLayout, (next, previous) => {
    const slide = slides.value && !morphing.value && ((next === 'cover' && previous === 'split') || (next === 'split' && previous === 'cover'))
    layout(slide, slide ? BIG_PICTURE.layoutMs : BIG_PICTURE.compactMs)
  }, { flush: 'post' })
  watch(() => appearance.effects, () => { for (const animation of animations.values()) animation.cancel(); layout() })
  onMounted(() => { observer = new ResizeObserver(schedule); if (root.value) observer.observe(root.value); root.value?.addEventListener('picture-settle', settle); schedule() })
  onBeforeUnmount(() => { cancelAnimationFrame(queued); observer?.disconnect(); root.value?.removeEventListener('picture-settle', settle); for (const animation of animations.values()) animation.cancel() })
}
