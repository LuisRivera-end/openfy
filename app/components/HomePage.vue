<script setup lang="ts">
import type { LibraryItem } from '../../shared/types/music'
import type { RecentCard } from '../../shared/types/telemetry'
import { recentRoute } from '../../shared/utils/recent'
import { describePlayback } from '../../shared/utils/playback'
import { isUnknownSong, knownMusic } from '../../shared/utils/discovery'
import { storeToRefs } from 'pinia'
import { songCount } from '../../shared/utils/text'
const library = useLibraryStore(), player = usePlayerStore(), telemetry = useTelemetryStore()
const importOpen = useState('importOpen', () => false)
const home = useHomeStore()
const { recommendations, recent, busy, error, ready } = storeToRefs(home)
const { loadRecent, loadRecommendations } = home
const recentSongs = computed(() => recent.value.items.flatMap(card => card.kind === 'song' && card.item ? [card.item] : []))
const known = computed(() => knownMusic([...library.collectionMap.values(), ...recentSongs.value]))
function playRecent(card: RecentCard) {
  const index = recentSongs.value.findIndex(item => item.id === card.item?.id)
  if (index >= 0) player.playEntries(recentSongs.value.map(item => item.entry), index, { kind: 'song' })
}
const suggestions = computed<LibraryItem[]>(() => (recommendations.value?.songs || []).filter(song => isUnknownSong(song, known.value) && !telemetry.stats.byTrack[`youtube:${song.videoId}`]?.listenedMs).slice(0, 12).map(song => {
  const entry = { source: 'youtube' as const, song }
  return { ...describePlayback(entry, library.trackMap)!, entry, genres: song.genres || [] }
}))
const favorites = computed(() => [...library.collectionMap.values()].filter(item => item.favorite))
const releaseYear = new Date().getFullYear()
const releases = computed(() => (recommendations.value?.releases || []).filter(release => release.year === releaseYear && !known.value.albums.has(release.id)).slice(0, 12))
const playlists = computed(() => library.playlists.slice(0, favorites.value.length ? 11 : 12))
const hasMusic = computed(() => library.collectionMap.size > 0 || recent.value.items.length > 0 || library.playlists.length > 0 || suggestions.value.length > 0 || releases.value.length > 0)
function playlistCover(ids: string[]) { return ids.map(id => library.collectionMap.get(id)?.artwork).find(Boolean) }
onMounted(() => { void useStartupStore().track(home.ready ? Promise.all([loadRecent(), loadRecommendations()]) : home.initialize()) })
watch(() => library.connected, connected => { if (ready.value && connected) { void loadRecent(); void loadRecommendations() } })
watch(() => telemetry.stats.lastPlayedAt, () => { if (ready.value) { void loadRecent(); if (suggestions.value.length < 6) void loadRecommendations() } })
watch(() => library.collectionMap.size, () => { if (ready.value && !suggestions.value.length) void loadRecommendations() })
</script>

<template>
  <div class="home-page">
    <h1>Inicio</h1>
    <HomeShelf v-if="hasMusic || busy || !ready || library.loading" title="Sugerencias para ti" featured>
      <template #action><button class="home-refresh" :disabled="busy || !library.connected" :aria-label="busy ? 'Buscando…' : 'Actualizar'" @click="loadRecommendations(true)"><OIcon class="home-refresh-icon" :class="{ spin: busy }" :name="busy ? 'loading' : 'refresh'" :size="18" /><span class="home-refresh-label">{{ busy ? 'Buscando…' : 'Actualizar' }}</span></button></template>
      <HomeSongCard v-for="(item, i) in suggestions" :key="item.id" :item="item" featured @play="player.playEntries(suggestions.map(song => song.entry), i)" />
      <template v-if="!suggestions.length && (busy || !ready || library.loading)"><div v-for="i in 4" :key="i" class="home-placeholder" aria-hidden="true"><OIcon name="music" :size="36" /></div></template>
      <div v-else-if="!suggestions.length" class="home-suggestion-empty"><OIcon name="headphones" :size="30" /><p>{{ error || recommendations?.error || 'Descubre tu próxima canción a partir de lo que escuchas y guardas.' }}</p><NuxtLink class="home-search-link" to="/search">Buscar música</NuxtLink></div>
    </HomeShelf>
    <p v-if="suggestions.length && (error || recommendations?.error)" class="home-status" role="status">{{ error || recommendations?.error }}</p>
    <div v-if="ready && !library.loading && !hasMusic && !busy" class="home-welcome"><OIcon name="headphones" :size="36" /><h2>¿Qué quieres escuchar?</h2><p>Busca una canción o añade música de tu PC.</p><div><NuxtLink class="button primary" to="/search">Buscar música</NuxtLink><button class="button subtle" :disabled="!library.connected" @click="importOpen = true">Importar música</button></div></div>
    <HomeShelf v-if="releases.length" :title="`Lanzamientos de ${releaseYear}`"><NuxtLink v-for="release in releases" :key="release.id" data-home-card :to="`/music/album/${encodeURIComponent(release.id)}`" class="home-collection"><AlbumCover :src="release.artwork" :title="release.title" /><strong :title="release.title">{{ release.title }}</strong><span>{{ release.artists.map(artist => artist.name).join(', ') }}</span><span>{{ release.year }}</span></NuxtLink></HomeShelf>
    <HomeShelf v-if="recent.items.length" title="Escuchado recientemente">
      <template v-for="card in recent.items" :key="card.key">
        <HomeSongCard v-if="card.kind === 'song' && card.item" :item="card.item" :context="{ kind: 'song' }" @play="playRecent(card)" />
        <NuxtLink v-else-if="recentRoute(card)" data-home-card :to="recentRoute(card)!" class="home-collection"><AlbumCover :src="card.artwork" :title="card.title" :favorite="card.kind === 'favorites'" /><strong :title="card.title">{{ card.title }}</strong><span>{{ card.subtitle }}</span></NuxtLink>
      </template>
    </HomeShelf>
    <HomeShelf v-if="favorites.length || playlists.length" title="Tus favoritas y playlists">
      <NuxtLink v-if="favorites.length" data-home-card to="/favorites" class="home-collection"><AlbumCover favorite /><strong>Tus favoritas</strong><span>{{ songCount(favorites.length) }}</span></NuxtLink>
      <NuxtLink v-for="list in playlists" :key="list.id" data-home-card :to="`/playlist/${encodeURIComponent(list.id)}`" class="home-collection"><AlbumCover :src="playlistCover(list.trackIds)" :title="list.name" /><strong :title="list.name">{{ list.name }}</strong><span>Playlist</span></NuxtLink>
    </HomeShelf>
  </div>
</template>

<style scoped>
.home-page { min-width: 0; }
h1 { font-size: 34px; line-height: 1.15; letter-spacing: -1px; margin: 0 0 20px; }
.home-refresh { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 0 8px; font-size: 12px; color: #a1a1aa; border-radius: 22px; }
.home-refresh-icon { display: none; }
@media (hover: hover) { .home-refresh:hover { color: #1ed760; } }
.home-collection { display: flex; flex-direction: column; gap: 3px; border-radius: 8px; }
.home-collection :deep(.album-cover) { width: 100%; aspect-ratio: 1; border-radius: 8px; margin-bottom: 7px; }
.home-collection strong, .home-collection > span { font-size: 14px; font-weight: 600; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.home-collection > span { color: #a1a1aa; font-size: 12px; font-weight: 400; }
.home-placeholder { height: 350px; border-radius: 10px; background: #202024; display: grid; place-items: center; color: #55555e; }
.home-suggestion-empty { flex-basis: min(100%, 580px) !important; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 22px 0; color: #a1a1aa; line-height: 1.6; }
.home-suggestion-empty p { max-width: 52ch; }
.home-search-link { color: #1ed760; font-size: 14px; min-height: 32px; }
.home-status { color: #a1a1aa; font-size: 12px; margin: -16px 0 24px; }
.home-welcome { padding: 32px 0 44px; display: flex; flex-direction: column; gap: 16px; align-items: flex-start; }
.home-welcome > svg { color: #a1a1aa; }
.home-welcome p { color: #a1a1aa; }
.home-welcome > div { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 4px; }
@media (max-width: 700px) { h1 { font-size: 30px; } .home-placeholder { height: 325px; } }
/* Phones: the refresh is an icon so the shelf title stays on one line. */
@media (max-width: 760px), (pointer: coarse) and (max-height: 500px) { .home-refresh { width: 44px; min-height: 44px; padding: 0; } .home-refresh-icon { display: block; } .home-refresh-label { display: none; } .home-search-link { display: inline-flex; align-items: center; min-height: 44px; } }
</style>
