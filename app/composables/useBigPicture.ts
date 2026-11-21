import { BIG_PICTURE, nextCardBounds, upcomingSeconds, type NextCardBounds } from '../../shared/utils/immersive'
import type { NowPlaying } from '../../shared/types/music'
import type { AmbientRect } from '../lib/ambient-gl'

interface AmbientPreview {
  preparePreview(artwork?: string | null, palette?: string[]): Promise<void>
  positionPreview(rect: AmbientRect, radius?: number, frameTime?: number): void
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

interface MobilePictureStage { root: Ref<HTMLElement | undefined>; active: Ref<boolean>; turned: Ref<boolean> }

/** Presentation only: neither the inactivity timer nor the reveal can advance audio. */
export function useBigPicture(root: Ref<HTMLDialogElement | undefined>, blocked: Ref<boolean>, mobile: MobilePictureStage, avoid?: Ref<{ right: number, bottom: number } | null>) {
  const player = usePlayerStore(), appearance = useAppearanceStore()
  const desktop = useBigPictureAvailable()
  const enabled = computed(() => desktop.value || mobile.active.value)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const cardMotion = computed(() => appearance.effects && !reducedMotion.value)
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
  const announcement = ref(''), cardStyle = shallowRef<Record<string, string>>(), flyingStyle = ref<Record<string, string>>({})
  const identity = () => player.queue[player.index]?.queueId
  const sceneKey = ref(identity())
  let shownId = identity(), pendingId: string | undefined, previewId: string | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined, frame = 0, generation = 0, held = false, keyboard = false
  let sceneTimer: ReturnType<typeof setTimeout> | undefined
  let stageObserver: ResizeObserver | undefined, resizeFrame = 0
  let lastInteraction = performance.now(), windowFocused = true, pointerAway = false
  let lastPointer = '', cardRect: NextCardBounds | undefined, cardFrame = 0
  let cardMove: { from: NextCardBounds, to: NextCardBounds, started: number, ends: number, entering: boolean } | undefined
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
    generation++; cancelAnimationFrame(frame); frame = 0; stopCardMove(); cardRect = undefined; cardStyle.value = undefined
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
  function applyCard(rect: NextCardBounds, frameTime?: number) {
    cardRect = rect
    cardStyle.value = { left: '0px', top: '0px', width: `${rect.width / rect.scale}px`, transform: `translate(${rect.x}px, ${rect.y}px) scale(${rect.scale})` }
    ambient.value?.positionPreview(rect, 16 * rect.scale, frameTime)
  }
  function stopCardMove() { cancelAnimationFrame(cardFrame); cardFrame = 0; cardMove = undefined }
  function stepCard(now: number) {
    if (!cardMove) return
    const { from, to, started, ends, entering } = cardMove
    if (now >= ends || !cardMotion.value) { stopCardMove(); applyCard(to, now); return }
    const raw = Math.max(0, (now - started) / (ends - started))
    const t = entering ? 1 - (1 - raw) ** 3 : raw * raw * (3 - 2 * raw)
    const mix = (a: number, b: number) => a + (b - a) * t
    cardFrame = requestAnimationFrame(stepCard)
    applyCard({ x: mix(from.x, to.x), y: mix(from.y, to.y), width: mix(from.width, to.width), height: mix(from.height, to.height), scale: mix(from.scale, to.scale) }, now)
  }
  function moveCard(from: NextCardBounds, to: NextCardBounds, entering: boolean) {
    const started = performance.now()
    cardMove = { from, to, started, ends: started + (entering ? BIG_PICTURE.cardEnterMs : BIG_PICTURE.compactMs), entering }
    cardFrame = requestAnimationFrame(stepCard)
    applyCard(from)
  }
  function dimensions() {
    const stage = mobile.active.value && mobile.root.value
    return stage ? { width: stage.clientWidth, height: stage.clientHeight } : { width: innerWidth, height: innerHeight }
  }
  function bounds(element: Element | null | undefined) {
    if (!element) return
    const rect = element.getBoundingClientRect()
    const stageElement = mobile.active.value && mobile.root.value
    if (!stageElement) return rect
    const stage = stageElement.getBoundingClientRect()
    // A media-query change and the viewport resize can arrive on different frames.
    const rotation = new DOMMatrixReadOnly(getComputedStyle(stageElement).transform)
    return rotation.b > .5
      ? new DOMRect(rect.top - stage.top, stage.right - rect.right, rect.height, rect.width)
      : new DOMRect(rect.left - stage.left, rect.top - stage.top, rect.width, rect.height)
  }
  /** Above the dock with the controls visible; the larger bottom-right corner card in compact mode. */
  function locateCard() {
    if (!root.value || !card.value || morphing.value) return
    const dockElement = root.value.querySelector<HTMLElement>('.immersive-seek')
    const contentElement = root.value.querySelector<HTMLElement>('.immersive-content')
    const dock = bounds(dockElement)
    const content = bounds(contentElement)
    if (!dockElement || !contentElement || !dock || !content) return
    const dockTop = dock.top - new DOMMatrixReadOnly(getComputedStyle(dockElement).transform).m42
    const { width, height } = dimensions()
    let target = nextCardBounds(width, height, content.right, content.width, dockTop, idle.value, avoid?.value ?? null)
    if (mobile.active.value) {
      const scale = idle.value ? .73 : .60
      const cardWidth = Math.min(280, content.width * .36)
      const style = getComputedStyle(contentElement)
      const right = content.right - parseFloat(style.paddingRight)
      const bottom = idle.value ? height - parseFloat(style.paddingBottom) : dockTop - 6
      target = { x: right - cardWidth, y: bottom - BIG_PICTURE.cardHeight * scale, width: cardWidth, height: BIG_PICTURE.cardHeight * scale, scale }
    }
    if (!cardMotion.value) { stopCardMove(); applyCard(target); return }
    if (cardMove) {
      const previous = cardMove.to
      if (cardMove.entering && cardRect && (target.x !== previous.x || target.y !== previous.y || target.width !== previous.width || target.scale !== previous.scale)) {
        cardMove.from = cardRect
        cardMove.started = performance.now()
      }
      cardMove.to = target
      return
    }
    if (!cardRect) moveCard({ ...target, x: width }, target, true)
    else if (cardRect.scale !== target.scale) moveCard(cardRect, target, false)
    else applyCard(target)
  }
  async function reveal() {
    if (morphing.value || !pendingId || !player.playing || player.buffering) return
    const destination = identity()
    if (!card.value || card.value.entry.queueId !== destination || !cardRect || !enabled.value) { stopMorph(); syncScene(); return }
    if (prefersReducedMotion()) { stopMorph(true); syncScene(); return }
    const { width, height } = dimensions()
    const from = cardRect.x >= width && cardMove?.entering ? cardMove.to : cardRect
    stopCardMove()
    if (from !== cardRect) applyCard(from)
    const own = ++generation, s = from.scale
    root.value?.dispatchEvent(new Event('picture-settle'))
    const target = bounds(root.value?.querySelector('.immersive-artwork'))
    if (!target) { stopMorph(true); syncScene(); return }
    morphing.value = true
    // The cover leaves from its place inside the (possibly scaled) card.
    const artFrom = { x: from.x + 16 * s, y: from.y + 20 * s, width: 80 * s, height: 80 * s }
    const started = performance.now()
    function draw(now: number) {
      if (own !== generation) return
      const raw = Math.min(1, (now - started) / BIG_PICTURE.transitionMs), t = raw * raw * (3 - 2 * raw)
      const mix = (a: number, b: number) => a + (b - a) * t
      ambient.value?.positionPreview({ x: mix(from.x, 0), y: mix(from.y, 0), width: mix(from.width, width), height: mix(from.height, height) }, 16 * s * (1 - t))
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
  if (avoid) watch(avoid, () => locateCard(), { flush: 'post' })
  watch([enabled, blocked], () => { lastInteraction = performance.now(); idle.value = false; arm(); void updatePreview() })
  watch(cardMotion, motion => {
    if (motion) return
    if (morphing.value) { stopMorph(true); syncScene() }
    else if (cardMove) locateCard()
  })
  function resize() { if (morphing.value) { stopMorph(true); syncScene() } else locateCard() }
  function resizeOnNextFrame() {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(resize)
  }
  function windowResized() {
    if (mobile.active.value) resizeOnNextFrame()
    else resize()
  }
  watch(mobile.turned, resizeOnNextFrame, { flush: 'post' })
  function visibility() { clearTimer(); if (!document.hidden) { if (morphing.value) { stopMorph(true); syncScene() } arm() } }
  onMounted(() => {
    arm(); void updatePreview()
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release); window.addEventListener('blur', blur); window.addEventListener('focus', windowFocus)
    window.addEventListener('resize', windowResized); document.addEventListener('visibilitychange', visibility)
    if (mobile.root.value) {
      stageObserver = new ResizeObserver(() => { if (mobile.active.value) resizeOnNextFrame() })
      stageObserver.observe(mobile.root.value)
    }
  })
  onBeforeUnmount(() => {
    clearTimer(); clearTimeout(sceneTimer); stopMorph()
    stageObserver?.disconnect()
    cancelAnimationFrame(resizeFrame)
    window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); window.removeEventListener('blur', blur); window.removeEventListener('focus', windowFocus)
    window.removeEventListener('resize', windowResized); document.removeEventListener('visibilitychange', visibility)
  })
  return { enabled, desktop, idle, scene, sceneEntry, sceneKey, card, countdown, announcement, ambient, cardStyle, flyingStyle, morphing, switching, handlers, locateCard }
}
