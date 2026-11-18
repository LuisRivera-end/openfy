import { BIG_PICTURE, nextCardBounds, upcomingSeconds, type NextCardBounds } from '../../shared/utils/immersive'
import type { NowPlaying } from '../../shared/types/music'
import type { AmbientRect } from '../lib/ambient-gl'

interface AmbientPreview {
  preparePreview(artwork?: string | null, palette?: string[]): Promise<void>
  positionPreview(rect: AmbientRect, radius?: number): void
  clearPreview(promote?: boolean): void
}

/** A desktop browser tab: no phone layout, a precise pointer, and never the installed app. */
export function useBigPictureAvailable() {
  const phone = usePhone(), pointer = useMediaQuery('(hover: hover) and (pointer: fine)')
  const installed = useState<boolean>('openfy-installed-context', () => false)
  const standalone = useMediaQuery('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)')
  watch(standalone, value => { if (value) installed.value = true }, { immediate: true })
  return computed(() => !phone.value && pointer.value && !installed.value)
}

/** Presentation only: neither the inactivity timer nor the reveal can advance audio. */
export function useBigPicture(root: Ref<HTMLDialogElement | undefined>, blocked: Ref<boolean>) {
  const player = usePlayerStore(), appearance = useAppearanceStore()
  const enabled = useBigPictureAvailable()
  const idle = ref(false), morphing = ref(false), switching = ref(false)
  const ambient = ref<AmbientPreview>()
  const scene = shallowRef<NowPlaying | undefined>(player.current)
  /** The queue entry of the scene on screen, which lags behind the player while a transition is held. */
  const sceneEntry = shallowRef(player.queue[player.index])
  const show = () => { scene.value = player.current; sceneEntry.value = player.queue[player.index] }
  type Next = NonNullable<typeof player.nextAutomatic>
  const card = shallowRef<Next | null>(null)
  const remaining = computed(() => upcomingSeconds(player.position, player.duration))
  const countdown = computed(() => player.error ? '' : player.buffering || remaining.value === 0 ? 'Preparando reproducción…'
    : !player.playing ? `En pausa · ${remaining.value ?? 0} s restantes` : `Empieza en ${remaining.value ?? 0} s`)
  const announcement = ref(''), cardStyle = ref<Record<string, string>>({}), flyingStyle = ref<Record<string, string>>({})
  const identity = () => player.queue[player.index]?.queueId
  const sceneKey = ref(identity())
  let shownId = identity(), pendingId: string | undefined, previewId: string | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined, frame = 0, generation = 0, held = false, keyboard = false
  let sceneTimer: ReturnType<typeof setTimeout> | undefined
  let lastInteraction = performance.now(), windowFocused = true, pointerAway = false
  let lastPointer = '', startRect: NextCardBounds | undefined, cardTarget: NextCardBounds | undefined, cardFrame = 0
  const clearTimer = () => { clearTimeout(idleTimer); idleTimer = undefined }
  function dockFocused() {
    const focused = document.activeElement
    return windowFocused && !pointerAway && keyboard && focused instanceof Element && !!focused.closest('.immersive-seek, .immersive-transport, .immersive-footer')
  }
  function arm() {
    clearTimer()
    if (!enabled.value || document.hidden || blocked.value || held || dockFocused()) return
    idleTimer = setTimeout(() => {
      if (blocked.value || held || dockFocused()) return
      const focused = document.activeElement
      if (focused instanceof HTMLElement && focused.closest('.immersive-seek, .immersive-transport, .immersive-footer')) root.value?.focus({ preventScroll: true })
      idle.value = true
    }, Math.max(0, BIG_PICTURE.idleMs - (performance.now() - lastInteraction)))
  }
  function activity(event?: Event) {
    if (!enabled.value) return
    if (event instanceof PointerEvent) {
      const point = `${event.clientX},${event.clientY}`
      if (event.type === 'pointermove' && point === lastPointer) return
      lastPointer = point; keyboard = false; pointerAway = false
    }
    if (event instanceof KeyboardEvent) { keyboard = true; pointerAway = false }
    lastInteraction = performance.now(); idle.value = false; arm()
  }
  function press(event: PointerEvent) { held = true; activity(event) }
  function release() { if (held) lastInteraction = performance.now(); held = false; arm() }
  function leave(event: PointerEvent) { pointerAway = true; keyboard = false; lastPointer = ''; if (!event.buttons) held = false; arm() }
  function blur() { windowFocused = false; pointerAway = true; keyboard = false; held = false; arm() }
  function windowFocus() { windowFocused = true; arm() }
  const handlers = { onPointermove: activity, onPointerleave: leave, onPointerdownCapture: press, onLostpointercapture: release, onWheelCapture: activity, onKeydownCapture: activity, onFocusin: arm, onFocusout: () => queueMicrotask(arm) }

  function stopMorph(promote = false) {
    generation++; cancelAnimationFrame(frame); frame = 0; stopCardMove(); startRect = undefined
    ambient.value?.clearPreview(promote)
    morphing.value = false; pendingId = undefined; previewId = undefined
    card.value = null; flyingStyle.value = {}
  }
  function syncScene() { clearTimeout(sceneTimer); switching.value = false; show(); shownId = identity(); sceneKey.value = shownId }
  function fadeScene() {
    if (!enabled.value || !scene.value || prefersReducedMotion()) { syncScene(); return }
    clearTimeout(sceneTimer); switching.value = true; shownId = identity()
    sceneTimer = setTimeout(() => { show(); sceneKey.value = identity(); switching.value = false; void updatePreview() }, 160)
  }
  /** One layout, uniformly scaled: the box is (width / scale) × cardHeight. */
  function applyCard(rect: NextCardBounds) {
    startRect = rect
    cardStyle.value = { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width / rect.scale}px`, transform: `scale(${rect.scale})` }
    ambient.value?.positionPreview(rect, 16 * rect.scale)
  }
  function stopCardMove() { cancelAnimationFrame(cardFrame); cardFrame = 0 }
  /** Above the dock with the controls visible; the larger bottom-right corner card in compact mode. */
  function locateCard() {
    if (!root.value || !card.value || morphing.value) return
    const dockElement = root.value.querySelector<HTMLElement>('.immersive-seek')
    const dock = dockElement?.getBoundingClientRect()
    const content = root.value.querySelector('.immersive-content')?.getBoundingClientRect()
    if (!dock || !content) return
    const dockTop = dock.top - new DOMMatrixReadOnly(getComputedStyle(dockElement!).transform).m42
    const target = nextCardBounds(innerWidth, innerHeight, content.right, content.width, dockTop, idle.value)
    if (cardFrame) { cardTarget = target; return }
    if (!startRect || startRect.scale === target.scale || !appearance.effects || prefersReducedMotion()) { applyCard(target); return }
    // Switching between the docked and the corner card: tween per frame so the ambient region follows it.
    const from = startRect, started = performance.now()
    cardTarget = target
    const step = (now: number) => {
      const raw = Math.min(1, (now - started) / BIG_PICTURE.compactMs), t = raw * raw * (3 - 2 * raw), to = cardTarget!
      const mix = (a: number, b: number) => a + (b - a) * t
      if (raw < 1) { applyCard({ x: mix(from.x, to.x), y: mix(from.y, to.y), width: mix(from.width, to.width), height: mix(from.height, to.height), scale: mix(from.scale, to.scale) }); cardFrame = requestAnimationFrame(step) }
      else { cardFrame = 0; applyCard(to) }
    }
    cardFrame = requestAnimationFrame(step)
  }
  async function reveal() {
    if (morphing.value || !pendingId || !player.playing || player.buffering) return
    const destination = identity()
    if (!card.value || card.value.entry.queueId !== destination || !startRect || !enabled.value) { stopMorph(); syncScene(); return }
    if (prefersReducedMotion()) { stopMorph(true); syncScene(); return }
    stopCardMove()
    const own = ++generation, from = { ...startRect }, s = from.scale
    root.value?.dispatchEvent(new Event('picture-settle'))
    const target = root.value?.querySelector('.immersive-artwork')?.getBoundingClientRect()
    if (!target) { stopMorph(true); syncScene(); return }
    morphing.value = true
    // The cover leaves from its place inside the (possibly scaled) card.
    const artFrom = { x: from.x + 16 * s, y: from.y + 20 * s, width: 80 * s, height: 80 * s }
    const started = performance.now()
    function draw(now: number) {
      if (own !== generation) return
      const raw = Math.min(1, (now - started) / BIG_PICTURE.transitionMs), t = raw * raw * (3 - 2 * raw)
      const mix = (a: number, b: number) => a + (b - a) * t
      ambient.value?.positionPreview({ x: mix(from.x, 0), y: mix(from.y, 0), width: mix(from.width, innerWidth), height: mix(from.height, innerHeight) }, 16 * s * (1 - t))
      flyingStyle.value = { left: `${mix(artFrom.x, target!.x)}px`, top: `${mix(artFrom.y, target!.y)}px`, width: `${mix(artFrom.width, target!.width)}px`, height: `${mix(artFrom.height, target!.height)}px` }
      if (raw < 1 && !prefersReducedMotion()) frame = requestAnimationFrame(draw)
      else { stopMorph(true); syncScene(); void nextTick(updatePreview) }
    }
    draw(started)
  }
  async function updatePreview() {
    if (!enabled.value) { stopMorph(); syncScene(); return }
    if (morphing.value) {
      if (identity() !== pendingId || player.error) { stopMorph(); fadeScene(); return }
      else return
    }
    if (identity() !== shownId) {
      if (card.value?.entry.queueId === identity() && !player.error) { pendingId = identity(); void reveal(); return }
      stopMorph(); fadeScene(); return
    }
    if (switching.value) return
    const next = player.nextAutomatic
    if (remaining.value === null || !next?.track || next.entry.queueId === identity() || player.repeat === 'one' || player.error) {
      if (card.value) stopMorph()
      return
    }
    const changed = previewId !== next.entry.queueId || card.value?.track?.artwork !== next.track.artwork
    card.value = next
    if (changed) {
      previewId = next.entry.queueId
      announcement.value = `A continuación: ${next.track.title}, ${next.track.artist}`
      await nextTick()
      if (previewId !== next.entry.queueId || card.value?.entry.queueId !== next.entry.queueId) return
      locateCard()
      if (next.track.artwork) void loadArtwork(next.track.artwork, 1024).catch(() => {})
      await ambient.value?.preparePreview(next.track.artwork, next.track.palette)
    }
  }
  watch(() => [enabled.value, identity(), player.current, player.nextAutomatic, remaining.value, player.playing, player.buffering, player.error], () => {
    if (identity() === shownId && !switching.value) show()
    void updatePreview()
  }, { flush: 'sync' })
  watch(idle, () => locateCard(), { flush: 'post' })
  watch([enabled, blocked], () => { lastInteraction = performance.now(); idle.value = false; arm(); void updatePreview() })
  watch(() => appearance.effects, () => { if (morphing.value && !appearance.effects) { stopMorph(true); syncScene() } })
  function resize() { if (morphing.value) { stopMorph(true); syncScene() } else locateCard() }
  function visibility() { clearTimer(); if (!document.hidden) { if (morphing.value) { stopMorph(true); syncScene() } arm() } }
  onMounted(() => {
    arm(); void updatePreview()
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release); window.addEventListener('blur', blur); window.addEventListener('focus', windowFocus)
    window.addEventListener('resize', resize); document.addEventListener('visibilitychange', visibility)
  })
  onBeforeUnmount(() => {
    clearTimer(); clearTimeout(sceneTimer); stopMorph()
    window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); window.removeEventListener('blur', blur); window.removeEventListener('focus', windowFocus)
    window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility)
  })
  return { enabled, idle, scene, sceneEntry, sceneKey, card, countdown, announcement, ambient, cardStyle, flyingStyle, morphing, switching, handlers }
}
