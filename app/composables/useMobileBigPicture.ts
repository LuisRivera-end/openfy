import type { InjectionKey, Ref } from 'vue'

export const turnedPlayerKey: InjectionKey<Ref<boolean>> = Symbol('turned player')

export function useMobileBigPictureAvailable() {
  const installed = useState<boolean>('openfy-installed-context', () => false)
  // A phone's short side stays the same when its viewport rotates.
  const touch = useMediaQuery('(pointer: coarse) and (max-width: 500px), (pointer: coarse) and (max-height: 500px)')
  return computed(() => installed.value && touch.value)
}

type Orientation = ScreenOrientation & { lock?: (value: 'landscape') => Promise<void> }
let releasePresentation: Promise<void> | undefined

export function useMobileBigPicture(playing: Ref<boolean>) {
  const available = useMobileBigPictureAvailable()
  const landscape = useMediaQuery('(orientation: landscape)')
  const manual = ref(false), dismissed = ref(false)
  const active = computed(() => available.value && (manual.value || (landscape.value && !dismissed.value)))
  const turned = computed(() => active.value && manual.value && !landscape.value)
  watch(landscape, value => { if (!value) dismissed.value = false }, { flush: 'sync' })

  let fullscreen = false, locked = false
  let entering: Promise<void> | undefined
  async function enter() {
    if (active.value || entering || releasePresentation) return
    manual.value = true
    if (landscape.value) dismissed.value = false
    const orientation = screen.orientation as Orientation | undefined
    entering = (async () => {
      if (document.fullscreenEnabled && !document.fullscreenElement) {
        try {
          await document.documentElement.requestFullscreen()
          fullscreen = true
          // Some implementations can reject fullscreen but permit a standalone orientation lock.
        } catch { /* The rotated player remains available. */ }
      }
      if (manual.value && orientation?.lock) {
        try { await orientation.lock('landscape'); locked = true }
        catch { /* The rotated player remains available. */ }
      }
    })()
    try { await entering } finally { entering = undefined }
  }

  function leave() {
    dismissed.value = landscape.value
    if (!manual.value) return
    manual.value = false
    const release = async () => {
      await entering
      if (locked) {
        try { screen.orientation?.unlock?.() } catch { /* The browser may have released the lock already. */ }
        locked = false
      }
      if (fullscreen && document.fullscreenElement === document.documentElement) {
        await document.exitFullscreen().catch(() => {})
      }
      fullscreen = false
    }
    releasePresentation = release().finally(() => { releasePresentation = undefined })
  }

  function fullscreenChanged() {
    if (fullscreen && !document.fullscreenElement) leave()
  }
  let mounted = false
  let sentinel: WakeLockSentinel | undefined
  let requesting = false, generation = 0
  const shouldWake = () => mounted && active.value && playing.value && !document.hidden
  async function syncWakeLock() {
    if (!shouldWake()) {
      generation++
      const held = sentinel
      sentinel = undefined
      if (held) await held.release().catch(() => {})
      return
    }
    if (!navigator.wakeLock || requesting || sentinel) return
    requesting = true
    const own = generation
    try {
      const granted = await navigator.wakeLock.request('screen')
      if (own !== generation || !shouldWake()) await granted.release()
      else if (!granted.released) {
        sentinel = granted
        granted.addEventListener('release', () => { if (sentinel === granted) sentinel = undefined }, { once: true })
      }
    } catch { /* Screen policy can change independently of playback. */ }
    finally {
      requesting = false
      if (own !== generation && shouldWake()) void syncWakeLock()
    }
  }
  const updateWake = () => { void syncWakeLock() }
  watch([active, playing], updateWake, { flush: 'sync' })
  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', updateWake)
    document.addEventListener('fullscreenchange', fullscreenChanged)
    updateWake()
  })
  onBeforeUnmount(() => {
    mounted = false
    document.removeEventListener('visibilitychange', updateWake)
    document.removeEventListener('fullscreenchange', fullscreenChanged)
    leave()
    updateWake()
  })
  return { available, active, turned, enter, leave }
}

/** Restore scroll along the player's logical vertical axis when WebKit sees a horizontal finger movement. */
export function useTurnedScroll(turned: Ref<boolean> | undefined, scroller: (event: PointerEvent) => HTMLElement | undefined) {
  let gesture: { id: number; x: number; top: number; element: HTMLElement } | undefined
  let dragged = false
  return {
    onPointerdown(event: PointerEvent) {
      dragged = false
      if (!turned?.value || event.pointerType === 'mouse' || event.button !== 0) return
      const element = scroller(event)
      if (element && element.scrollHeight > element.clientHeight) {
        gesture = { id: event.pointerId, x: event.clientX, top: element.scrollTop, element }
      }
    },
    onPointermove(event: PointerEvent) {
      if (!gesture || gesture.id !== event.pointerId) return
      const delta = event.clientX - gesture.x
      if (!dragged && Math.abs(delta) < 6) return
      dragged = true
      gesture.element.scrollTop = gesture.top + delta
    },
    onPointerup() { gesture = undefined },
    onPointercancel() { gesture = undefined; dragged = false },
    onClickCapture(event: MouseEvent) {
      if (!dragged) return
      dragged = false
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
