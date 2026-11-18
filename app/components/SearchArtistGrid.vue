<script setup lang="ts">
import type { YouTubeArtist } from '../../shared/types/music'
defineProps<{ artists: YouTubeArtist[] }>()
</script>

<template>
  <div class="album-grid search-artist-grid"><NuxtLink v-for="artist in artists" :key="artist.id" :to="`/music/artist/${artist.id}`" class="album-card artist-card"><AlbumCover :src="artist.artwork" :title="artist.name" /><strong>{{ artist.name }}</strong><span>Artista</span></NuxtLink></div>
</template>
