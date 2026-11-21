<script setup lang="ts">
import { albumDescriptionDialogOpen } from '../composables/useAlbumPresentation'

const props = defineProps<{
  title: string
  description?: { text: string; source: 'apple' | 'youtube' } | null
}>()

const dialogOpen = ref(false)
const hasOverflow = ref(false)
const textRef = ref<HTMLElement>()
const moreBtnRef = ref<HTMLButtonElement>()

const attributionText = computed(() => {
  return props.description?.source === 'apple' ? 'Texto de Apple Music' : 'Texto de YouTube Music'
})

const paragraphs = computed(() => {
  if (!props.description?.text) return []
  return props.description.text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
})

function checkOverflow() {
  const el = textRef.value
  if (!el) {
    hasOverflow.value = false
    return
  }
  hasOverflow.value = el.scrollHeight > el.clientHeight + 1
}

function openDialog() {
  dialogOpen.value = true
  albumDescriptionDialogOpen.value = true
}

function closeDialog() {
  dialogOpen.value = false
  albumDescriptionDialogOpen.value = false
  nextTick(() => {
    moreBtnRef.value?.focus()
  })
}

let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  nextTick(checkOverflow)
  if (textRef.value) {
    resizeObserver = new ResizeObserver(() => {
      checkOverflow()
    })
    resizeObserver.observe(textRef.value)
  }
  window.addEventListener('resize', checkOverflow, { passive: true })
})

onBeforeUnmount(() => {
  albumDescriptionDialogOpen.value = false
  resizeObserver?.disconnect()
  window.removeEventListener('resize', checkOverflow)
})

watch(() => props.description?.text, () => {
  nextTick(checkOverflow)
})
</script>

<template>
  <div v-if="description?.text" class="album-description">
    <p ref="textRef" class="album-description-text">{{ description.text }}</p>
    <button
      v-if="hasOverflow"
      ref="moreBtnRef"
      type="button"
      class="album-description-more"
      aria-haspopup="dialog"
      aria-label="Más información sobre este álbum"
      @click="openDialog"
    >
      Más
    </button>
    <AppDialog
      :open="dialogOpen"
      :title="title"
      class="album-description-dialog"
      @close="closeDialog"
    >
      <div class="album-description-dialog-body">
        <p v-for="(p, i) in paragraphs" :key="i" class="album-description-dialog-p">{{ p }}</p>
        <p class="album-description-attribution">{{ attributionText }}</p>
      </div>
    </AppDialog>
  </div>
</template>

<style scoped>
.album-description {
  margin-top: 12px;
  max-width: 65ch;
}
.album-description-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre-line;
  font-size: 14px;
  line-height: 21px;
  color: var(--album-muted, #c8c8d0);
  margin: 0;
}
.album-description-more {
  display: block;
  margin-top: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #f4f4f5;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}
.album-description-more:hover {
  text-decoration: underline;
}
.album-description-dialog-body {
  max-height: min(60vh, 500px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
}
.album-description-dialog-p {
  color: #f4f4f5;
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 14px;
  white-space: pre-line;
}
.album-description-attribution {
  color: var(--album-muted, #a1a1aa);
  font-size: 12px;
  margin-top: 18px;
  border-top: 1px solid var(--album-surface, #ffffff15);
  padding-top: 10px;
}
</style>
