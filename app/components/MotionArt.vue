<script setup lang="ts">
/** A silent looping video over the static cover. It appears only once it is really playing. */
const props = defineProps<{ src: string; playing: boolean }>()
const emit = defineEmits<{ failed: [] }>()
const video = ref<HTMLVideoElement>()
const ready = ref(false)
function sync() {
  const element = video.value
  if (!element) return
  if (props.playing && !document.hidden) void element.play().catch(() => {})
  else element.pause()
}
watch(() => props.playing, sync)
onMounted(() => { document.addEventListener('visibilitychange', sync); sync() })
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', sync); video.value?.pause() })
</script>

<template>
  <video ref="video" class="motion-art" :class="{ 'is-ready': ready }" :src="src" muted loop playsinline preload="auto"
    disablepictureinpicture disableremoteplayback aria-hidden="true" tabindex="-1" @playing="ready = true" @canplay="sync" @error="emit('failed')" />
</template>
