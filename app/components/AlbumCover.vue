<script setup lang="ts">
import { artworkSize, artworkUrl } from '../../shared/utils/artwork'
const props = defineProps<{ src?: string | null; title?: string; palette?: string[]; favorite?: boolean; size?: number }>()
const emit = defineEmits<{ load: [] }>()
const root = ref<HTMLElement>()
const visible = ref(false), broken = ref(false), measured = ref(128)
const variant = computed(() => artworkSize(props.size || measured.value))
const source = useLocalArtwork(() => props.src)
const resolved = computed(() => artworkUrl(source.value, variant.value))
const image = ref(decodedArtwork(resolved.value))
let observer: IntersectionObserver | undefined, resize: ResizeObserver | undefined, generation = 0
let retry: ReturnType<typeof setTimeout> | undefined, attempts = 0
async function prepare() {
  const own = ++generation
  clearTimeout(retry)
  if (!source.value || props.favorite || !visible.value) return
  try {
    const decoded = await loadArtwork(source.value, variant.value)
    if (own === generation) { image.value = decoded.src; broken.value = false; attempts = 0 }
  } catch {
    if (own !== generation) return
    broken.value = !image.value
    if (++attempts <= 3) retry = setTimeout(prepare, 1500 * 2 ** attempts)
  }
}
watch([source, variant, visible], ([source], [previous]) => {
  const cached = decodedArtwork(resolved.value)
  if (source !== previous || cached) image.value = cached
  attempts = 0; broken.value = false; void prepare()
}, { flush: 'sync' })
onMounted(() => {
  // object-fit: cover fills by the larger side; a short, wide box still needs its full width in pixels.
  resize = new ResizeObserver(([entry]) => { if (entry) measured.value = Math.max(entry.contentRect.width, entry.contentRect.height) * (window.devicePixelRatio || 1) })
  resize.observe(root.value!)
  observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { visible.value = true; observer?.disconnect() } }, { rootMargin: '300px' })
  observer.observe(root.value!)
  window.addEventListener('online', prepare)
})
onBeforeUnmount(() => { generation++; clearTimeout(retry); observer?.disconnect(); resize?.disconnect(); window.removeEventListener('online', prepare) })
</script>

<template>
  <div ref="root" class="album-cover" :class="{ 'favorite-cover': favorite }" :style="{ '--cover-color': palette?.[0] || '#28483e' }">
    <img v-if="image && !broken && !favorite" :src="image" :alt="title ? `Portada de ${title}` : ''" decoding="async" @load="emit('load')" @error="broken = true">
    <OIcon v-else :name="favorite ? 'heart' : 'disc'" :size="40" />
    <slot />
  </div>
</template>
