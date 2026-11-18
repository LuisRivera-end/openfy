<script setup lang="ts">
import type { YouTubeArtistRef } from '../../shared/types/music'
defineProps<{ artists?: YouTubeArtistRef[]; names?: string[] }>()
</script>

<template>
  <span class="music-artist-names"><template v-if="artists?.length"><template v-for="(artist, i) in artists" :key="artist.id || `${artist.name}:${i}`"><span v-if="i">, </span><NuxtLink v-if="artist.id" :to="`/music/artist/${artist.id}`">{{ artist.name }}</NuxtLink><span v-else>{{ artist.name }}</span></template></template><template v-else>{{ names?.join(', ') || 'Artista desconocido' }}</template></span>
</template>

<style scoped>
@media (hover: hover) { a:hover { color: #f4f4f5; text-decoration: underline; } }
</style>
