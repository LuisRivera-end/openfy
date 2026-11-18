<script setup lang="ts">
import { AMBIENT, ambientPaletteTexture } from '../../shared/utils/ambient'
import { createAmbientRenderer, PHONE_AMBIENT, type AmbientRenderer, type AmbientRect } from '../lib/ambient-gl'
const props = withDefaults(defineProps<{ artwork?: string | null; palette?: string[]; playing: boolean; lyricsScrim?: number; scrimEases?: boolean }>(), { artwork: null, palette: () => [], lyricsScrim: 0, scrimEases: true })
const appearance = useAppearanceStore()
const reduced = ref(false)
const reducedQuery = import.meta.client ? matchMedia('(prefers-reduced-motion: reduce)') : undefined
const onReduced = () => { reduced.value = !!reducedQuery?.matches }
/** Same gate as the audio analysis in the player store: motion only while playing with effects on. */
const active = computed(() => props.playing && appearance.effects && !reduced.value)
const instant = computed(() => !appearance.effects || reduced.value)
const canvas = ref<HTMLCanvasElement>()
const failed = ref(false)
const fallback = ref<string[]>(['#234d3b', '#273c4e', '#3e2849'])
let renderer: AmbientRenderer | null = null, observer: ResizeObserver | undefined, generation = 0, loaded = false
const previewColors = ref<string[]>([]), previewClip = ref('inset(100%)')
let previewPixels: Uint8ClampedArray | null = null, previewSource: string | null | undefined, previewGeneration = 0, promotedSource: string | null | undefined

async function preparePreview(artwork?: string | null, palette: string[] = []) {
  const own = ++previewGeneration
  let pixels: Uint8ClampedArray
  try { pixels = artwork ? await artworkPixels(artwork) : ambientPaletteTexture(palette) }
  catch { pixels = ambientPaletteTexture(palette) }
  if (own !== previewGeneration) return
  previewPixels = pixels; previewSource = artwork; previewColors.value = thirds(pixels)
  renderer?.setPreview(pixels)
}
function positionPreview(rect: AmbientRect, radius = 16) {
  renderer?.setPreviewRegion(rect, radius)
  previewClip.value = `inset(${rect.y}px ${Math.max(0, innerWidth - rect.x - rect.width)}px ${Math.max(0, innerHeight - rect.y - rect.height)}px ${rect.x}px round ${radius}px)`
}
function clearPreview(promote = false) {
  previewGeneration++
  if (promote && previewPixels) { renderer?.setArtwork(previewPixels, true); fallback.value = thirds(previewPixels); promotedSource = previewSource; loaded = true }
  renderer?.setPreview(null); renderer?.setPreviewRegion(null)
  previewPixels = null; previewColors.value = []
}
defineExpose({ preparePreview, positionPreview, clearPreview })

/** The cover reduced to the shared texture size; colour thirds feed the CSS fallback. */
async function artworkPixels(source: string) {
  const image = await loadArtwork(source, 128)
  const size = AMBIENT.textureSize, scratch = document.createElement('canvas'); scratch.width = scratch.height = size
  const context = scratch.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0, size, size)
  return context.getImageData(0, 0, size, size).data
}
function thirds(pixels: Uint8ClampedArray) {
  const size = AMBIENT.textureSize, sums = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], counts = [0, 0, 0]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const third = Math.min(2, Math.floor(x * 3 / size)), offset = (y * size + x) * 4
    for (let channel = 0; channel < 3; channel++) sums[third]![channel]! += pixels[offset + channel]!
    counts[third]!++
  }
  return sums.map((sum, i) => '#' + sum.map(value => Math.round(value / counts[i]!).toString(16).padStart(2, '0')).join(''))
}
async function refresh() {
  const own = ++generation
  let pixels: Uint8ClampedArray
  try { pixels = props.artwork ? await artworkPixels(props.artwork) : ambientPaletteTexture(props.palette) }
  catch { pixels = ambientPaletteTexture(props.palette) }
  if (own !== generation) return
  fallback.value = thirds(pixels)
  // The first cover appears at once; later covers cross-fade.
  renderer?.setArtwork(pixels, instant.value || !loaded || props.artwork === promotedSource); promotedSource = undefined; loaded = true
}
function start() {
  if (!canvas.value) return
  // Touch screens get the lighter budget (30 FPS, slower motion, fewer pixels); desktops keep the full rate.
  const touch = matchMedia('(pointer: coarse)').matches
  renderer = createAmbientRenderer(canvas.value, () => { renderer?.dispose(); renderer = null; failed.value = true }, touch ? PHONE_AMBIENT : {})
  if (!renderer) { failed.value = true; return }
  observer = new ResizeObserver(() => renderer?.resize()); observer.observe(canvas.value)
  renderer.resize(); renderer.setLyricsScrim(props.lyricsScrim, true); renderer.setActive(active.value)
}
onMounted(() => { onReduced(); reducedQuery?.addEventListener('change', onReduced); start(); void refresh() })
onBeforeUnmount(() => { reducedQuery?.removeEventListener('change', onReduced); generation++; previewGeneration++; observer?.disconnect(); renderer?.dispose(); renderer = null })
watch(() => [props.artwork, props.palette.join()], () => void refresh())
watch(active, value => renderer?.setActive(value))
watch(() => props.lyricsScrim, value => renderer?.setLyricsScrim(value, instant.value || !props.scrimEases))
</script>

<template>
  <div class="ambient" :class="{ fallback: failed }" :data-ambient="failed ? 'css' : 'webgl'" aria-hidden="true" :style="{ '--ambient-one': fallback[0], '--ambient-two': fallback[1], '--ambient-three': fallback[2] }">
    <canvas v-if="!failed" ref="canvas" class="ambient-canvas"></canvas>
    <template v-else><i></i><i></i><i></i></template>
    <div v-if="failed && previewColors.length" class="ambient ambient-preview fallback" :style="{ clipPath: previewClip, '--ambient-one': previewColors[0], '--ambient-two': previewColors[1], '--ambient-three': previewColors[2] }"><i></i><i></i><i></i></div>
  </div>
</template>
