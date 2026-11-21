<script setup lang="ts">
import { albumDescriptionDialogOpen } from '../composables/useAlbumPresentation'

/** A silent looping video over the static cover. Crossfades after the first presented frame. */
const props = withDefaults(defineProps<{
  src: string
  playing?: boolean
}>(), {
  playing: true,
})

const emit = defineEmits<{ failed: [] }>()
const video = ref<HTMLVideoElement>()
const ready = ref(false)
const player = usePlayerStore()

let observer: IntersectionObserver | undefined
let frameTimeout: ReturnType<typeof setTimeout> | undefined
const inViewport = ref(false)

function markReady() {
  if (ready.value) return
  clearTimeout(frameTimeout)
  frameTimeout = undefined
  ready.value = true
}

function onPlaying() {
  const element = video.value
  if (!element) return
  if (!('requestVideoFrameCallback' in element)) {
    markReady()
  }
}

/** The 8 s budget only runs while the video is supposed to play, so an intentional pause never counts as a failure. */
function armFrameTimer() {
  if (ready.value || frameTimeout) return
  frameTimeout = setTimeout(() => { frameTimeout = undefined; if (!ready.value) emit('failed') }, 8000)
}
function disarmFrameTimer() { clearTimeout(frameTimeout); frameTimeout = undefined }

function sync() {
  const element = video.value
  if (!element) return
  const isImmersive = !!element.closest('.immersive')
  const covered = player.expanded && !isImmersive
  const shouldPlay = props.playing && inViewport.value && !document.hidden && !covered && !albumDescriptionDialogOpen.value
  if (!shouldPlay) { disarmFrameTimer(); element.pause(); return }
  armFrameTimer()
  // Only a frame presented while playing reveals the video; a preloaded paused frame does not.
  if (!ready.value && 'requestVideoFrameCallback' in element) element.requestVideoFrameCallback(() => { if (!element.paused) markReady() })
  element.play().catch(error => {
    if ((error as DOMException)?.name === 'AbortError') return
    disarmFrameTimer()
    emit('failed')
  })
}

watch(() => props.src, () => { disarmFrameTimer(); ready.value = false; sync() })
watch(() => props.playing, sync)
watch(() => player.expanded, sync)
watch(albumDescriptionDialogOpen, sync)

onMounted(() => {
  const element = video.value
  if (element && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(([entry]) => { inViewport.value = !!entry?.isIntersecting; sync() }, { threshold: 0.05 })
    observer.observe(element)
  } else {
    inViewport.value = true
  }
  document.addEventListener('visibilitychange', sync)
  sync()
})

onBeforeUnmount(() => {
  disarmFrameTimer()
  observer?.disconnect()
  document.removeEventListener('visibilitychange', sync)
  video.value?.pause()
})
</script>

<template>
  <video
    ref="video"
    class="motion-art"
    :class="{ 'is-ready': ready }"
    :src="src"
    muted
    loop
    playsinline
    preload="auto"
    disablepictureinpicture
    disableremoteplayback
    aria-hidden="true"
    tabindex="-1"
    @playing="onPlaying"
    @canplay="sync"
    @error="emit('failed')"
  />
</template>
