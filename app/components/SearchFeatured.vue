<script setup lang="ts">
import type { YouTubeAlbum, YouTubeAlbumDetail, YouTubeArtist, YouTubeArtistProfile, YouTubeSong } from '../../shared/types/music'
import { knownArtistTheme, useArtistTheme } from '../composables/useArtistTheme'

const props = defineProps<{
  featured:
    | { kind: 'artist'; item: YouTubeArtist }
    | { kind: 'album'; item: YouTubeAlbum }
    | { kind: 'song'; item: YouTubeSong }
}>()

const player = usePlayerStore()

const title = computed(() => {
  if (props.featured.kind === 'artist') return props.featured.item.name
  return props.featured.item.title
})

const artwork = computed(() => props.featured.item.artwork)

const typeLine = computed(() => {
  if (props.featured.kind === 'artist') return 'Artista'
  if (props.featured.kind === 'song') return `Canción · ${props.featured.item.artists.join(', ')}`
  return `Álbum · ${props.featured.item.artists.map(a => a.name).join(', ')}`
})

const href = computed(() => {
  if (props.featured.kind === 'artist') return `/music/artist/${props.featured.item.id}`
  if (props.featured.kind === 'album') return `/music/album/${props.featured.item.id}`
  return undefined
})

const cacheKey = computed(() => {
  if (props.featured.kind === 'artist') return 'youtube:' + props.featured.item.id
  return undefined
})

// The artist page's palette wins when it exists; the portrait sample is never stored under the artist id.
const sampled = useArtistTheme(() => artwork.value)
const theme = computed(() => (cacheKey.value && knownArtistTheme(cacheKey.value)) || sampled.value)

/** A later click or a new result invalidates a pending play, so a slow response never replaces a newer queue. */
let generation = 0
const loading = ref(false)
const playError = ref('')
watch(() => props.featured.item, () => { generation++; loading.value = false; playError.value = '' })
onBeforeUnmount(() => { generation++ })

async function play() {
  const own = ++generation
  const current = () => own === generation
  playError.value = ''
  if (props.featured.kind === 'song') {
    const song = props.featured.item
    player.playYouTube([song], 0, { kind: 'song' })
    return
  }

  loading.value = true
  if (props.featured.kind === 'album') {
    const album = props.featured.item
    try {
      const data = await $fetch<YouTubeAlbumDetail>(`/api/music/albums/${encodeURIComponent(album.id)}`)
      if (!current()) return
      loading.value = false
      if (data?.songs?.length) {
        player.playYouTube(data.songs, 0, {
          kind: 'album',
          id: 'youtube:' + album.id,
          title: data.title,
          subtitle: data.artists.map(a => a.name).join(', '),
          artwork: data.artwork,
        })
        return
      }
    } catch {}
    if (current()) { loading.value = false; playError.value = 'No se pudo reproducir este álbum. Inténtalo de nuevo.' }
    return
  }

  if (props.featured.kind === 'artist') {
    const artist = props.featured.item
    try {
      const profile = await $fetch<YouTubeArtistProfile>(`/api/music/artists/${encodeURIComponent(artist.id)}`)
      if (!current()) return
      loading.value = false
      if (profile?.topSongs?.length) {
        player.playYouTube(profile.topSongs, 0, {
          kind: 'artist',
          id: 'youtube:' + artist.id,
          title: profile.name,
          subtitle: 'Artista',
          artwork: profile.artwork,
        })
        return
      }
    } catch {}
    if (current()) { loading.value = false; playError.value = 'No se pudieron reproducir las canciones. Inténtalo de nuevo.' }
  }
}

function onCardClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('.search-featured-play')) return
  if (props.featured.kind === 'song') {
    void play()
  } else if (href.value) {
    void navigateTo(href.value)
  }
}
</script>

<template>
  <div
    class="search-featured-card"
    :class="{ 'artist-card': featured.kind === 'artist' }"
    :style="{
      '--featured-deep': theme.deep,
      background: `linear-gradient(180deg, ${theme.base} 0%, ${theme.deep} 100%)`,
    }"
    @click="onCardClick"
  >
    <div class="search-featured-cover-wrap">
      <AlbumCover
        :src="artwork"
        :title="title"
        :size="512"
        class="search-featured-cover"
        :class="{ 'is-artist': featured.kind === 'artist' }"
      />
    </div>
    <div class="search-featured-info">
      <NuxtLink v-if="href" :to="href" class="search-featured-title">{{ title }}</NuxtLink>
      <span v-else class="search-featured-title">{{ title }}</span>
      <div class="search-featured-meta">
        <span class="search-featured-type">{{ typeLine }}</span>
        <button
          class="search-featured-play"
          type="button"
          :aria-label="`Reproducir ${title}`"
          :disabled="loading"
          :aria-busy="loading"
          @click.stop="play"
        >
          <OIcon :name="loading ? 'loading' : 'play'" :class="{ spin: loading }" :size="22" />
        </button>
      </div>
      <p v-if="playError" class="search-featured-type" role="status">{{ playError }}</p>
    </div>
  </div>
</template>

<style scoped>
.search-featured-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 240px;
  border-radius: 16px;
  padding: 24px;
  cursor: pointer;
  overflow: hidden;
  box-shadow: 0 12px 32px #00000033;
  transition: transform 0.18s ease;
}
@media (hover: hover) {
  .search-featured-card:hover {
    transform: translateY(-2px);
  }
}
.search-featured-cover-wrap {
  margin-bottom: 20px;
}
.search-featured-cover {
  width: 120px;
  height: 120px;
  border-radius: 10px;
  box-shadow: 0 10px 28px #0000004d;
}
.search-featured-cover.is-artist,
.search-featured-card.artist-card .search-featured-cover {
  border-radius: 50%;
}
.search-featured-title {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: #ffffff;
  text-decoration: none;
  overflow-wrap: anywhere;
  margin-bottom: 6px;
  display: block;
}
.search-featured-title:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
  border-radius: 4px;
}
.search-featured-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.search-featured-type {
  color: #ededf0;
  font-size: 14px;
  font-weight: 500;
}
.search-featured-play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #ffffff;
  color: var(--featured-deep, #1c2129);
  box-shadow: 0 6px 18px #00000040;
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.15s ease;
  flex-shrink: 0;
}
@media (hover: hover) {
  .search-featured-card:hover .search-featured-play,
  .search-featured-card:focus-within .search-featured-play {
    opacity: 1;
  }
  .search-featured-play:hover {
    transform: scale(1.06);
  }
}
@media (any-pointer: coarse), (hover: none) {
  .search-featured-play {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .search-featured-card, .search-featured-play { transition: none; }
}
.search-featured-play:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
  opacity: 1;
}
@media (max-width: 480px) {
  .search-featured-card {
    padding: 18px;
    min-height: 200px;
  }
  .search-featured-cover {
    width: 96px;
    height: 96px;
  }
  .search-featured-title {
    font-size: 24px;
  }
}
</style>
