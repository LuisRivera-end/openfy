<script setup lang="ts">
import type { PlaybackEntry } from '../../shared/types/music'
// Links a song's artist to its profile: YouTube artists by id, local artists by name.
const props = defineProps<{ entry?: PlaybackEntry; artist?: string }>()
const localTarget = computed(() => props.entry?.source === 'local' && props.artist && props.artist !== 'Artista desconocido' ? `/artist/${encodeURIComponent(props.artist)}` : null)
</script>

<template>
  <span class="artist-link"><MusicArtistNames v-if="entry?.source === 'youtube'" :artists="entry.song.artistRefs" :names="entry.song.artists" /><NuxtLink v-else-if="localTarget" :to="localTarget" @click.stop>{{ artist }}</NuxtLink><template v-else>{{ artist }}</template></span>
</template>
