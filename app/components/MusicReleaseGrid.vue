<script setup lang="ts">
import type { YouTubeAlbum } from '../../shared/types/music'
const props = defineProps<{ albums: YouTubeAlbum[]; showArtist?: boolean }>()
const detail = (album: YouTubeAlbum) => props.showArtist
  ? [album.artists.map(artist => artist.name).join(', '), album.year].filter(Boolean).join(' · ') || 'Álbum'
  : String(album.year || 'Lanzamiento')
</script>

<template>
  <div class="album-grid catalog-release-grid"><NuxtLink v-for="album in albums" :key="album.id" :to="`/music/album/${album.id}`" class="album-card"><AlbumCover :src="album.artwork" :title="album.title" /><strong :title="album.title">{{ album.title }}</strong><span>{{ detail(album) }}</span></NuxtLink></div>
</template>
