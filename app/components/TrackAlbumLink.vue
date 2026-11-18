<script setup lang="ts">
import type { PlaybackEntry } from '../../shared/types/music'
// Links a song's album to its page: YouTube albums by id, local albums by their library id. Same rule as the song menu.
const props = defineProps<{ entry?: PlaybackEntry; album?: string; albumId?: string }>()
const library = useLibraryStore()
const target = computed(() => {
  const entry = props.entry
  if (!entry) return null
  if (entry.source === 'youtube') return entry.song.albumId ? `/music/album/${entry.song.albumId}` : null
  const id = props.albumId || library.trackMap.get(entry.trackId)?.albumId
  return id ? `/album/${encodeURIComponent(id)}` : null
})
</script>

<template>
  <span class="album-link"><NuxtLink v-if="target" :to="target" @click.stop>{{ album }}</NuxtLink><template v-else>{{ album }}</template></span>
</template>
