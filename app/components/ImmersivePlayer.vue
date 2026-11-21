<script setup lang="ts">
import type { LibraryItem } from '../../shared/types/music'
import { formatTime } from '../../shared/utils/media'
import { AMBIENT } from '../../shared/utils/ambient'
import { BIG_PICTURE, bigPictureLyrics, immersiveLayout } from '../../shared/utils/immersive'
import { turnedPlayerKey } from '../composables/useMobileBigPicture'
const emit = defineEmits<{ retry: [] }>()
const player = usePlayerStore()
const library = useLibraryStore()
const downloads = useDownloadsStore()
const appearance = useAppearanceStore()
const lyrics = useLyricsStore()
const current = computed(() => player.current!)
const entry = computed(() => player.queue[player.index])
const dialog = ref<HTMLDialogElement>()
const stage = ref<HTMLElement>()
const { available: mobileAvailable, active: mobile, turned, enter, leave } = useMobileBigPicture(computed(() => player.playing && !player.buffering))
provide(turnedPlayerKey, turned)
const fullscreenError = ref('')
const fullscreenAvailable = ref(false)
const viewport = ref({ width: 0, height: 0 })
const measure = () => { viewport.value = { width: window.innerWidth, height: window.innerHeight } }
/**
 * Wide screens show the lyrics beside the song (split). Narrow screens (the iPhone) open on the artwork
 * (cover) and switch to the lyrics under a compact header (stacked) with the lyrics button; the choice is remembered.
 * Big Picture keeps the lyrics column only for synced lyrics (bigPictureLyrics); otherwise the song stays alone in
 * the centre over the same dock (`is-docked`).
 */
const lyricsPane = ref(true)
// The first answer after opening is applied directly; later changes slide the song (BIG_PICTURE.layoutMs).
const layoutSlides = ref(false)
let lyricsAnswered = false
const wide = computed(() => mobile.value || immersiveLayout(viewport.value.width, viewport.value.height, true) === 'split')
const showLyrics = computed(() => (wide.value || appearance.immersiveLyrics) && (!bigPicture.value || lyricsPane.value))
const layout = computed(() => mobile.value ? (showLyrics.value ? 'split' : 'cover') : immersiveLayout(viewport.value.width, viewport.value.height, showLyrics.value))
const docked = computed(() => bigPicture.value && wide.value && layout.value === 'cover')
const menu = ref<LibraryItem | null>(null)
const queueSheet = ref(false)
const columnBounds = ref<{ right: number, bottom: number } | null>(null)
const { enabled: bigPicture, desktop, idle, scene, sceneEntry, sceneKey, card, countdown, announcement, ambient, cardStyle, flyingStyle, morphing, switching, handlers, locateCard } = useBigPicture(dialog, computed(() => !!menu.value || queueSheet.value), { root: stage, active: mobile, turned }, columnBounds)
watch([layout, docked], locateCard, { flush: 'post' })
const displayed = computed(() => scene.value || current.value)
// A held expansion keeps the outgoing scene, so its layout waits until the new song is on screen.
watch(() => [lyrics.result?.status ?? null, lyrics.loading, morphing.value] as const, ([status, loading, holding]) => {
  if (holding) return
  layoutSlides.value = lyricsAnswered
  lyricsPane.value = bigPictureLyrics(status, loading, lyricsPane.value)
  if (!loading) lyricsAnswered = true
}, { immediate: true })
const lyricsPaneMotion = () => bigPicture.value && layoutSlides.value && !prefersReducedMotion()
// Every large cover animates, phones included; the 56 px cover of the stacked layout stays static.
const motion = useMotionArt(computed(() => layout.value !== 'stacked'), sceneEntry)
useBigPicturePresentation(dialog, desktop, idle, computed(() => !!card.value), morphing, layout, layoutSlides, columnBounds)
const progress = computed(() => Number.isFinite(player.duration) && player.duration > 0 ? Math.max(0, Math.min(100, player.position / player.duration * 100)) : 0)

function favoriteCurrent() {
  if (entry.value?.source === 'youtube') void library.favoriteYouTube(entry.value.song)
  else void library.favorite(current.value.id)
}
async function fullscreen() {
  // The Fullscreen API excludes <dialog>; keep the modal over the fullscreen document on desktop.
  try { await (bigPicture.value ? document.documentElement : dialog.value)?.requestFullscreen(); fullscreenError.value = '' }
  catch { fullscreenError.value = 'La pantalla completa no está disponible en este navegador.' }
}
/** Wide screens dock the queue beside the page; narrow screens open it as a sheet over the player. */
function openQueue() {
  if (wide.value && !mobile.value) { player.expanded = false; player.queueOpen = true }
  else queueSheet.value = true
}
function openMenu() { if (entry.value) menu.value = { ...current.value, entry: entry.value } }
function close() { player.expanded = false }
function cancel(event: Event) {
  if (event.target === dialog.value && mobile.value) { event.preventDefault(); leave() }
}
function escape(event: KeyboardEvent) {
  if (queueSheet.value || menu.value) return
  if (mobile.value) {
    event.preventDefault()
    leave()
  } else close()
}
function turnedSeek(event: PointerEvent) {
  if (!turned.value) return
  const input = event.currentTarget as HTMLInputElement
  if (event.type === 'pointerdown') input.setPointerCapture(event.pointerId)
  else if (!input.hasPointerCapture(event.pointerId)) return
  event.preventDefault()
  const rect = input.getBoundingClientRect()
  if (rect.height) player.seek(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * Number(input.max))
}
const drag = useSheetDrag(dialog, close)
onMounted(() => {
  measure(); window.addEventListener('resize', measure)
  fullscreenAvailable.value = !!document.fullscreenEnabled
  lyrics.panelOpen = false
  dialog.value?.showModal()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  if (!mobileAvailable.value && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
})
</script>

<template>
  <dialog ref="dialog" v-bind="handlers" :class="{ 'motion-paused': !player.playing || !appearance.effects, 'big-picture': bigPicture, 'mobile-picture': mobile, 'picture-turned': turned, 'is-idle': idle, 'is-morphing': morphing, 'is-switching': switching, 'has-next-card': !!card }" :data-controls="idle ? 'compact' : 'full'" class="immersive" aria-label="Reproductor ampliado" tabindex="-1" autofocus @close="close" @cancel="cancel" @keydown.esc="escape">
  <div ref="stage" class="picture-stage">
    <AmbientCanvas ref="ambient" :artwork="displayed.artwork" :palette="displayed.palette" :playing="player.playing" :lyrics-scrim="layout === 'split' ? AMBIENT.lyricsScrim : 0" :scrim-eases="layoutSlides" />
    <div class="immersive-content" :class="[`layout-${layout}`, { 'is-docked': docked }]" :data-layout="layout">
      <header v-bind="mobile ? {} : drag">
        <button v-if="!mobile" class="icon-button" aria-label="Cerrar reproductor ampliado" @click="close"><OIcon name="down" :size="26" /></button>
        <button v-else class="icon-button picture-toggle" aria-label="Salir de Big Picture" @click="leave"><OIcon name="minimize" /></button>
        <span class="immersive-handle" aria-hidden="true" />
        <div class="immersive-header-tools">
          <button v-if="mobileAvailable && !mobile" class="icon-button picture-toggle" aria-label="Abrir Big Picture" @click="enter"><OIcon name="expand" /></button>
          <button v-else-if="!mobileAvailable && fullscreenAvailable" class="icon-button fullscreen-button" aria-label="Pantalla completa" @click="fullscreen"><OIcon name="expand" /></button>
          <button class="icon-button" aria-label="Opciones de la canción en reproductor ampliado" @click="openMenu"><OIcon name="more" :size="24" /></button>
        </div>
      </header>
      <div class="immersive-artwork-slot"><AlbumCover class="immersive-artwork" :src="displayed.artwork" :title="displayed.album" :palette="displayed.palette" v-bind="layout === 'cover' && !mobile ? drag : {}">
        <MotionArt v-if="motion.url.value" :key="motion.url.value" :src="motion.url.value" :playing="player.playing" @failed="motion.failed" />
      </AlbumCover></div>
      <div class="immersive-info-slot"><div class="immersive-info"><div><h1>{{ displayed.title }}</h1><p>{{ displayed.artist }}</p></div><button class="icon-button" :class="{ active: current.favorite }" :disabled="!library.connected" aria-label="Marcar favorito" :aria-pressed="current.favorite" @click="favoriteCurrent"><OIcon name="heart" :size="25" /></button>
        <div v-if="bigPicture" class="immersive-mini" :aria-hidden="!idle"><div role="progressbar" aria-label="Progreso de la canción" :aria-valuenow="Math.round(progress)" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="`${formatTime(player.position)} de ${formatTime(player.duration)}`" class="mini-track"><span :style="{ width: `${progress}%` }" /></div><div class="mini-times"><span>{{ formatTime(player.position) }}</span><span>{{ formatTime(player.duration) }}</span></div></div>
      </div></div>
      <Transition name="lyrics-pane" :css="lyricsPaneMotion()" :duration="{ enter: BIG_PICTURE.layoutMs, leave: 250 }"><div v-if="layout !== 'cover'" class="immersive-lyrics-slot"><div class="immersive-lyrics" role="region" aria-label="Letras"><LyricsPanel :key="bigPicture ? sceneKey : 'lyrics'" variant="immersive" :snap-on-load="bigPicture" :anchor="layout === 'split' ? .35 : .5" :depth="bigPicture" @retry="emit('retry')" /></div></div></Transition>
      <div class="immersive-seek" :inert="idle"><input type="range" aria-label="Posición en reproductor ampliado" :aria-valuetext="formatTime(player.position)" min="0" :max="Number.isFinite(player.duration) ? player.duration : 0" :value="player.position" step="0.1" @pointerdown="turnedSeek" @pointermove="turnedSeek" @input="player.seek(Number(($event.target as HTMLInputElement).value))"><div><span>{{ formatTime(player.position) }}</span><span>{{ formatTime(player.duration) }}</span></div></div>
      <div class="immersive-transport transport" :inert="idle">
        <button class="icon-button toggle" :class="{ active: player.shuffle }" aria-label="Aleatorio en reproductor ampliado" :aria-pressed="player.shuffle" @click="player.toggleShuffle"><OIcon name="shuffle" :size="22" /></button>
        <button class="icon-button" aria-label="Anterior en reproductor ampliado" @click="player.advance(-1)"><OIcon name="previous" :size="30" /></button>
        <button class="play-button" :aria-label="player.playing ? 'Pausar en reproductor ampliado' : 'Reproducir en reproductor ampliado'" @click="player.toggle"><OIcon :name="player.playing ? 'pause' : 'play'" :size="30" /></button>
        <button class="icon-button" aria-label="Siguiente en reproductor ampliado" @click="player.advance(1)"><OIcon name="next" :size="30" /></button>
        <button class="icon-button toggle" :class="{ active: player.repeat !== 'off' }" aria-label="Repetir en reproductor ampliado" @click="player.cycleRepeat"><OIcon :name="player.repeat === 'one' ? 'repeatOne' : 'repeat'" :size="22" /></button>
      </div>
      <div class="immersive-footer" :inert="idle">
        <span><OIcon :name="downloads.readyIds.has(current.id) ? 'check' : 'headphones'" :size="16" />{{ downloads.readyIds.has(current.id) ? 'Disponible sin conexión' : current.format }}</span>
        <div class="immersive-tools">
          <button v-if="!wide && (!bigPicture || lyricsPane)" class="icon-button toggle" :class="{ active: showLyrics }" aria-label="Letra en reproductor ampliado" :aria-pressed="showLyrics" @click="appearance.immersiveLyrics = !appearance.immersiveLyrics"><OIcon name="lyrics" /></button>
          <button class="icon-button" aria-label="Abrir cola desde reproductor ampliado" @click="openQueue"><OIcon name="queue" /></button>
          <span class="immersive-volume"><OIcon name="volume" :size="18" /><input aria-label="Volumen en reproductor ampliado" class="volume-slider" type="range" min="0" max="1" step="0.01" :value="player.volume" :aria-valuetext="`${Math.round(player.volume * 100)} %`" @input="player.setVolume(Number(($event.target as HTMLInputElement).value))"></span>
        </div>
      </div>
      <p v-if="player.error || fullscreenError" class="notice" role="status">{{ player.error || fullscreenError }}</p>
    </div>
    <aside v-if="bigPicture && card?.track && cardStyle" class="next-card" :style="cardStyle" aria-label="Siguiente canción">
      <AlbumCover :src="card.track.artwork" :palette="card.track.palette" :size="1024" class="next-card-artwork" />
      <div class="next-card-copy"><span>A continuación</span><strong>{{ card.track.title }}</strong><p>{{ card.track.artist }}</p><div><span>{{ countdown }}</span><span v-if="card.track.duration > 0">{{ formatTime(card.track.duration) }}</span></div></div>
    </aside>
    <AlbumCover v-if="morphing && card?.track" class="next-flying-artwork" :style="flyingStyle" :src="card.track.artwork" :palette="card.track.palette" :size="1024" aria-hidden="true" />
    <span v-if="bigPicture" class="sr-only" role="status" aria-live="polite">{{ announcement }}</span>
  </div>
    <!-- Sheets open over the player (nested modal dialogs stay in the top layer). -->
    <AppDialog :open="queueSheet" title="Cola de reproducción" class="queue-sheet" @close="queueSheet = false"><PlaybackQueue variant="sheet" /></AppDialog>
    <SongActionsSheet :item="menu" :context="entry?.context" @close="menu = null" />
  </dialog>
</template>
