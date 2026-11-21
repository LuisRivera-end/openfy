<script setup lang="ts">
import { activeLyricsTime, activeLyricsWord } from '../../shared/utils/lyrics'
import { formatTime } from '../../shared/utils/media'
import { turnedPlayerKey } from '../composables/useMobileBigPicture'
const props = withDefaults(defineProps<{ variant?: 'panel' | 'immersive'; anchor?: number; snapOnLoad?: boolean; depth?: boolean }>(), { variant: 'panel', anchor: .5, snapOnLoad: false, depth: false })
const emit = defineEmits<{ retry: [] }>()
const lyrics = useLyricsStore()
const player = usePlayerStore()
const downloads = useDownloadsStore()
const viewport = ref<HTMLElement>()
const turned = inject(turnedPlayerKey, undefined)
const turnedScroll = useTurnedScroll(turned, () => viewport.value)
const following = ref(true)
// The clock follows timeupdate, and every animation frame while a line with word timing plays.
const clock = ref(player.position)
let frame = 0
let initialSync = props.snapOnLoad, followGeneration = 0
let resizeObserver: ResizeObserver | undefined
// While sweeping, timeupdate only corrects real jumps (seeks) so the word never flickers backwards.
watch(() => player.position, value => { if (!frame || Math.abs(value - clock.value) > .75) clock.value = value })
const activeTime = computed(() => activeLyricsTime(lyrics.result?.lines || [], clock.value))
const activeIndex = computed(() => activeTime.value === null ? -1 : (lyrics.result?.lines || []).findIndex(line => line.time === activeTime.value))
const activeLine = computed(() => activeIndex.value < 0 ? undefined : lyrics.result?.lines[activeIndex.value])
const nextLineTime = computed(() => lyrics.result?.lines.find(line => activeTime.value !== null && line.time > activeTime.value)?.time ?? null)
const wordTimed = computed(() => lyrics.result?.status === 'synced' && !!lyrics.result.lines.some(line => line.words?.length))
const wordIndex = computed(() => activeLyricsWord(activeLine.value, nextLineTime.value, clock.value)?.index ?? -1)
/** Only the sung word's fill variable changes per frame; Vue re-renders when the word or line changes. */
function sweep() {
  frame = 0
  if (!player.playing || document.hidden || !wordTimed.value) return
  clock.value = player.livePosition()
  paint()
  frame = requestAnimationFrame(sweep)
}
function paint() {
  const state = activeLyricsWord(activeLine.value, nextLineTime.value, clock.value)
  viewport.value?.querySelector<HTMLElement>('.lyrics-word.singing')?.style.setProperty('--p', String(state?.progress ?? 0))
}
function restartSweep() { cancelAnimationFrame(frame); frame = 0; if (player.playing && !document.hidden && wordTimed.value) frame = requestAnimationFrame(sweep); else void nextTick(paint) }
watch([() => player.playing, wordTimed], restartSweep)
watch(wordIndex, () => void nextTick(paint))
/** Distance from the active line drives the immersive fall-off; capped so long songs stay cheap to restyle. */
const distance = (index: number) => activeIndex.value < 0 ? 4 : Math.min(4, Math.abs(index - activeIndex.value))
const manualKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

async function follow() {
  if (!following.value || document.hidden) return
  const own = ++followGeneration
  await nextTick()
  if (own !== followGeneration) return
  const container = viewport.value
  const line = container?.querySelector<HTMLElement>('[aria-current="true"]')
  if (!container || !line) return
  const rect = line.getBoundingClientRect(), outer = container.getBoundingClientRect()
  const vertical = turned?.value ? outer.right - rect.right + rect.width / 2 : rect.top - outer.top + rect.height / 2
  const scale = (turned?.value ? outer.width : outer.height) / container.clientHeight || 1
  container.scrollTo({ top: container.scrollTop + vertical / scale - container.clientHeight * props.anchor,
    behavior: initialSync || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  initialSync = false
}
function resume() { following.value = true; void follow() }
watch(activeTime, follow)
if (turned) watch(turned, () => { initialSync = true; void follow() })
watch(() => lyrics.result, () => {
  following.value = true
  if (props.snapOnLoad) { initialSync = true; clock.value = player.position; viewport.value?.scrollTo({ top: 0, behavior: 'instant' }) }
  void follow()
})
onMounted(() => { void follow(); restartSweep(); document.addEventListener('visibilitychange', follow); document.addEventListener('visibilitychange', restartSweep) })
watch(viewport, value => { resizeObserver?.disconnect(); if (props.depth && value) { resizeObserver = new ResizeObserver(() => { initialSync = true; void follow() }); resizeObserver.observe(value) } })
onBeforeUnmount(() => { resizeObserver?.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', follow); document.removeEventListener('visibilitychange', restartSweep) })
</script>

<template>
  <section class="lyrics-view" :class="`lyrics-${props.variant}`" aria-label="Letra de la canción" :aria-busy="lyrics.loading">
    <div v-if="lyrics.loading" class="lyrics-message" role="status"><OIcon name="loading" class="spin" /><p>Buscando la letra…</p></div>
    <div v-else-if="lyrics.error" class="lyrics-message" role="status"><p>{{ lyrics.error }}</p><button class="button subtle" @click="emit('retry')">Reintentar letras</button></div>
    <div v-else-if="!lyrics.result || lyrics.result.status === 'not_found'" class="lyrics-message" role="status">
      <OIcon name="lyrics" :size="32" /><p>{{ lyrics.offline ? 'La letra no está guardada en este dispositivo.' : 'No encontramos letras para esta canción.' }}</p>
      <span v-if="lyrics.offline && downloads.readyIds.has(player.current?.id || '')">El audio descargado sigue disponible sin conexión.</span>
      <span v-else-if="lyrics.offline">Conecta con tu PC para buscar esta letra.</span>
      <button v-else class="button subtle" @click="emit('retry')">Reintentar letras</button>
    </div>
    <div v-else-if="lyrics.result.status === 'instrumental'" class="lyrics-message" role="status"><OIcon name="music" :size="32" /><p>Esta canción es instrumental.</p></div>
    <template v-else>
      <div class="lyrics-mode"><span>{{ lyrics.result.status !== 'synced' ? 'Letra sin sincronización' : wordTimed ? 'Letra sincronizada por palabra' : 'Letra sincronizada' }}</span><span v-if="lyrics.offline">Sin conexión</span></div>
      <div class="lyrics-scroll-shell" :class="{ 'has-depth': props.depth }"><div ref="viewport" class="lyrics-scroll" v-bind="turnedScroll" tabindex="0" aria-label="Versos de la canción" @wheel.passive="following = false" @touchstart.passive="following = false" @pointerdown="following = false" @keydown="manualKeys.has($event.key) && (following = false)">
        <template v-if="lyrics.result.status === 'synced'">
          <template v-for="(line, index) in lyrics.result.lines" :key="index">
            <button v-if="line.text" class="lyrics-line" :class="{ current: line.time === activeTime, past: activeTime !== null && line.time < activeTime }" :style="{ '--d': distance(index) }" :aria-current="line.time === activeTime ? 'true' : undefined" :aria-label="`${line.text} · ${formatTime(line.time)}`" @click="player.seek(line.time)"><template v-if="line.words && line.time === activeTime"><span v-for="(word, w) in line.words" :key="w" class="lyrics-word" :class="{ sung: w < wordIndex, singing: w === wordIndex }">{{ word.text }}</span></template><template v-else>{{ line.text }}</template></button>
            <div v-else class="lyrics-gap" :aria-current="line.time === activeTime ? 'true' : undefined" aria-hidden="true">···</div>
          </template>
        </template>
        <p v-else class="lyrics-plain">{{ lyrics.result.plainText }}</p>
      </div></div>
      <!-- Its space is always reserved: appearing must not shift a verse away from the finger that is tapping it. -->
      <button v-if="lyrics.result.status === 'synced'" class="button subtle lyrics-follow" :class="{ 'lyrics-follow-idle': following }" :tabindex="following ? -1 : undefined" @click="resume"><OIcon name="down" :size="16" />Seguir reproducción</button>
    </template>
    <p v-if="lyrics.storageError" class="lyrics-storage" role="status">{{ lyrics.storageError }}</p>
    <footer v-if="lyrics.result?.attribution" class="lyrics-attribution"><a v-if="lyrics.result.sourceUrl" :href="lyrics.result.sourceUrl" target="_blank" rel="noopener noreferrer">{{ lyrics.result.attribution }}</a><span v-else>{{ lyrics.result.attribution }}</span></footer>
  </section>
</template>
