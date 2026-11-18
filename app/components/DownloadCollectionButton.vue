<script setup lang="ts">
import type { PlaybackEntry } from '../../shared/types/music'
const props = defineProps<{ kind: 'playlist' | 'album'; id: string; title: string; entries: PlaybackEntry[]; artwork?: string | null }>()
const downloads = useDownloadsStore()
const targetId = computed(() => props.kind === 'album' ? props.id.replace(/^youtube:/, '') : props.id)
const key = computed(() => `${props.kind}:${targetId.value}`)
const progress = computed(() => downloads.progress(key.value))
const enabled = computed(() => !!downloads.collections[key.value]?.enabled)
</script>

<template>
  <button class="button subtle collection-download" :aria-pressed="enabled" :aria-label="enabled ? `Mantener descargado · ${progress.completed}/${progress.total}` : 'Descargar esta colección'" :disabled="!entries.length && !enabled"
    @click="downloads.toggleCollection(kind, targetId, { title, entries, artwork: artwork || null })">
    <OIcon :name="progress.ready ? 'check' : 'download'" :size="18" />
    <span class="button-label">{{ enabled ? `Mantener descargado · ${progress.completed}/${progress.total}` : 'Descargar en este dispositivo' }}</span>
  </button>
</template>

<style scoped>
.collection-download { max-width: 100%; white-space: normal; }
</style>
