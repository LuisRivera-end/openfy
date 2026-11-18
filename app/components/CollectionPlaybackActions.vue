<script setup lang="ts">
import type { LibraryItem } from '../../shared/types/music'
import type { ListeningContext } from '../../shared/types/telemetry'
defineProps<{ items: LibraryItem[]; context?: ListeningContext }>()
const player = usePlayerStore()
</script>

<template>
  <div class="collection-playback-actions">
    <button class="button primary" aria-label="Reproducir esta colección" :disabled="!items.length" @click="player.playCollection(items.map(item => item.entry), { context })"><OIcon name="play" :size="18" /><span class="button-label">Reproducir</span></button>
    <button class="button subtle" aria-label="Reproducir esta colección en aleatorio" :disabled="!items.length" @click="player.playCollection(items.map(item => item.entry), { shuffle: true, context })"><OIcon name="shuffle" :size="18" /><span class="button-label">Aleatorio</span></button>
  </div>
</template>
