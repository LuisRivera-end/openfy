/**
 * Touch gestures for the phone shell. Each composable returns pointer handlers to `v-bind` on the element that
 * receives the gesture. They are no-ops on the desktop layout, and every action stays reachable with a button.
 */
type Handlers = Record<string, (event: Event) => void>

const DISMISS_DISTANCE = 80
const DISMISS_VELOCITY = .6 // px per ms
const reduced = () => prefersReducedMotion()

/**
 * Drag a sheet (or the expanded player) down to dismiss it. The element follows the finger, springs back when the
 * drag is short, and calls `dismiss` past 80 px or on a quick flick. Taps on buttons inside the handle still work.
 */
export function useSheetDrag(target: Ref<HTMLElement | undefined>, dismiss: () => void): Handlers {
  const phone = usePhone()
  let start = 0, startTime = 0, distance = 0, pointer: number | null = null, dragging = false
  function reset(animate: boolean) {
    const element = target.value
    if (!element) return
    element.style.transition = animate && !reduced() ? 'transform .26s cubic-bezier(.32, .72, 0, 1)' : 'none'
    element.style.transform = ''
    if (animate) setTimeout(() => { if (element.style.transform === '') element.style.transition = '' }, 300)
  }
  return {
    onPointerdown(event: Event) {
      const down = event as PointerEvent
      if (!phone.value || down.button !== 0 || (down.target as Element).closest('button, a, input')) return
      pointer = down.pointerId; start = down.clientY; startTime = performance.now(); distance = 0; dragging = false
    },
    onPointermove(event: Event) {
      const move = event as PointerEvent
      if (pointer !== move.pointerId || !target.value) return
      distance = Math.max(0, move.clientY - start)
      if (!dragging && distance > 6) {
        dragging = true
        try { (move.currentTarget as Element).setPointerCapture(move.pointerId) } catch { /* Pointer already released. */ }
        target.value.style.transition = 'none'
      }
      if (dragging) target.value.style.transform = `translateY(${distance}px)`
    },
    onPointerup(event: Event) {
      const up = event as PointerEvent
      if (pointer !== up.pointerId) return
      pointer = null
      if (!dragging) return
      dragging = false
      const velocity = distance / Math.max(1, performance.now() - startTime)
      if (distance > DISMISS_DISTANCE || (velocity > DISMISS_VELOCITY && distance > 24)) { dismiss(); reset(false) }
      else reset(true)
    },
    onPointercancel() { if (dragging) reset(true); pointer = null; dragging = false },
  }
}

/** A quick upward swipe (the mini player opening the expanded player). Taps keep their own click handler. */
export function useSwipeUp(action: () => void): Handlers {
  const phone = usePhone()
  let start = 0, pointer: number | null = null
  return {
    onPointerdown(event: Event) { const down = event as PointerEvent; if (phone.value && down.button === 0) { pointer = down.pointerId; start = down.clientY } },
    onPointerup(event: Event) {
      const up = event as PointerEvent
      if (pointer === up.pointerId && start - up.clientY > 40) action()
      pointer = null
    },
    onPointercancel() { pointer = null },
  }
}

/**
 * Long press (500 ms without moving more than 10 px) or the context menu opens a song's options. The click that
 * follows a long press is swallowed so the song does not also start playing. Returns a binder per element:
 * `v-bind="press(() => open(item))"`; one press runs at a time.
 */
export function useLongPress() {
  let timer: ReturnType<typeof setTimeout> | undefined, x = 0, y = 0, fired = false
  const cancel = () => { clearTimeout(timer); timer = undefined }
  if (getCurrentInstance()) onBeforeUnmount(cancel)
  return (action: () => void): Handlers => ({
    onPointerdown(event: Event) {
      const down = event as PointerEvent
      fired = false
      if (down.pointerType === 'mouse' || down.button !== 0) return
      x = down.clientX; y = down.clientY
      cancel()
      timer = setTimeout(() => { timer = undefined; fired = true; action() }, 500)
    },
    onPointermove(event: Event) { const move = event as PointerEvent; if (timer && Math.hypot(move.clientX - x, move.clientY - y) > 10) cancel() },
    onPointerup: cancel,
    onPointercancel: cancel,
    // Desktop right-click, and touch browsers that fire contextmenu after their own long press (already handled).
    onContextmenu(event: Event) { event.preventDefault(); if (fired) return; cancel(); action() },
    onClickCapture(event: Event) { if (fired) { event.preventDefault(); event.stopPropagation(); fired = false } },
  })
}
