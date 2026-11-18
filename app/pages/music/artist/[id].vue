<script setup lang="ts">
import type { ListeningContext } from '../../../../shared/types/telemetry'
import type { YouTubeAlbum, YouTubeArtistProfile, YouTubeSong } from '../../../../shared/types/music'
const route = useRoute()
const id = computed(() => String(route.params.id))
const { disconnected } = useMusicConnection()
const library = useLibraryStore()
const player = usePlayerStore()
const expandedBiography = ref(false)
watch(id, () => { expandedBiography.value = false })
const { data: artist, status, error, refresh } = await useFetch<YouTubeArtistProfile>(() => `/api/music/artists/${encodeURIComponent(id.value)}`, { lazy: true, timeout: 20000, retry: 0 })
const loadError = computed(() => (error.value?.data as { message?: string } | undefined)?.message || 'No se pudo consultar este artista.')
useStartupContent(() => disconnected.value || status.value === 'success' || status.value === 'error')
const songs = useMusicCollection<YouTubeSong>(() => `/api/music/artists/${encodeURIComponent(id.value)}/songs`, 'songs')
const albums = useMusicCollection<YouTubeAlbum>(() => `/api/music/artists/${encodeURIComponent(id.value)}/releases`, 'albums', { kind: 'albums' })
const singles = useMusicCollection<YouTubeAlbum>(() => `/api/music/artists/${encodeURIComponent(id.value)}/releases`, 'albums', { kind: 'singles' })
const visibleSongs = computed(() => songs.started ? songs.items : artist.value?.topSongs || [])
const releases = computed(() => [
  { kind: 'albums' as const, title: 'Álbumes', collection: albums, preview: artist.value?.albums || [] },
  { kind: 'singles' as const, title: 'Singles y EPs', collection: singles, preview: artist.value?.singles || [] },
])
/** Newest release across both shelves; provider order breaks ties. */
const latest = computed(() => {
  const all = [...(artist.value?.albums || []).map(album => ({ album, kind: 'Álbum' })), ...(artist.value?.singles || []).map(album => ({ album, kind: 'Single / EP' }))]
  return all.reduce<typeof all[number] | null>((best, item) => !best || (item.album.year || 0) > (best.album.year || 0) ? item : best, null)
})
const similar = computed(() => artist.value?.similar || [])
const listeningContext = computed<ListeningContext | undefined>(() => artist.value ? { kind: 'artist', id: 'youtube:' + id.value, title: artist.value.name, subtitle: 'Artista', artwork: artist.value.artwork } : undefined)
function shuffle() {
  const list = visibleSongs.value
  if (!list.length) return
  player.playYouTube(list, Math.floor(Math.random() * list.length), listeningContext.value)
  player.toggleShuffle()
}
watch(disconnected, value => { if (!value && (!artist.value || error.value)) void refresh() })
useHead({ title: () => artist.value ? `${artist.value.name} · Openfy` : 'Artista · Openfy' })
</script>

<template>
  <div class="page-content catalog-page artist-page">
    <DetailBar :title="artist?.name" fallback="/search" />
    <div v-if="disconnected" class="empty-state" role="status"><OIcon name="offline" :size="44" /><h1>Conecta para explorar este artista.</h1><p>Necesitas conexión con tu PC e Internet.</p><button class="button subtle" @click="library.refresh">Reintentar conexión</button></div>
    <div v-else-if="status === 'pending' || status === 'idle'" class="empty-state" role="status"><OIcon name="loading" class="spin" :size="36" /><p>Cargando artista…</p></div>
    <div v-else-if="error || !artist" class="empty-state" role="status"><h1>Artista no disponible.</h1><p>{{ loadError }}</p><button class="button primary" @click="refresh()">Reintentar artista</button></div>
    <template v-else>
      <header class="catalog-artist-hero" :class="artist.banner ? 'has-banner' : 'has-portrait'">
        <div class="artist-stage">
          <div class="artist-backdrop" aria-hidden="true">
            <AlbumCover v-if="artist.banner" :src="artist.banner" :size="2048" />
            <AlbumCover v-else-if="artist.artwork" class="artist-backdrop-blur" :src="artist.artwork" :size="128" />
          </div>
          <AlbumCover v-if="!artist.banner" class="artist-portrait" :src="artist.artwork" :title="artist.name" :size="512" />
          <div class="catalog-artist-copy">
            <p class="artist-kind">Artista</p>
            <h1>{{ artist.name }}</h1>
          </div>
        </div>
        <div class="artist-actions">
          <button class="artist-play" :disabled="!visibleSongs.length" @click="player.playYouTube(visibleSongs, 0, listeningContext)"><OIcon name="play" :size="22" /><span>Reproducir</span></button>
          <button class="button subtle" :disabled="visibleSongs.length < 2" @click="shuffle"><OIcon name="shuffle" :size="18" />Aleatorio</button>
        </div>
      </header>

      <div class="artist-overview" :class="{ 'with-latest': latest }">
        <section class="catalog-section artist-popular" aria-labelledby="artist-songs-title">
          <div class="section-heading"><h2 id="artist-songs-title">{{ songs.started ? 'Canciones' : 'Canciones populares' }}</h2><button v-if="!songs.started && artist.expandable.songs" class="catalog-text-button" :disabled="songs.busy" @click="songs.load()">Ver todas las canciones</button></div>
          <YouTubeTrackList v-if="visibleSongs.length" :songs="visibleSongs" :label="`Canciones de ${artist.name}`" />
          <p v-else class="muted catalog-empty">Este artista todavía no tiene canciones disponibles.</p>
          <div v-if="songs.busy || songs.error || (songs.started && songs.cursor)" class="catalog-more"><p v-if="songs.error" role="status">{{ songs.error }}</p><p v-if="songs.busy" role="status">Cargando canciones…</p><button v-else class="button subtle" @click="songs.load(songs.expired)">{{ songs.error ? songs.expired ? 'Actualizar canciones' : 'Reintentar canciones' : 'Cargar más canciones' }}</button></div>
        </section>
        <aside v-if="latest" class="catalog-section artist-latest" aria-labelledby="artist-latest-title">
          <div class="section-heading"><h2 id="artist-latest-title">Último lanzamiento</h2></div>
          <NuxtLink :to="`/music/album/${latest.album.id}`" class="artist-latest-card">
            <AlbumCover :src="latest.album.artwork" :title="latest.album.title" :size="1024" />
            <strong :title="latest.album.title">{{ latest.album.title }}</strong>
            <span>{{ [latest.album.year, latest.kind].filter(Boolean).join(' · ') }}</span>
          </NuxtLink>
        </aside>
      </div>

      <section v-for="release in releases" :key="release.kind" class="catalog-section" :aria-labelledby="`artist-${release.kind}-title`">
        <div class="section-heading"><h2 :id="`artist-${release.kind}-title`">{{ release.title }}</h2></div>
        <MusicReleaseGrid :albums="release.collection.started ? release.collection.items : release.preview" />
        <p v-if="!(release.collection.started ? release.collection.items : release.preview).length" class="muted catalog-empty">No hay {{ release.title.toLocaleLowerCase('es') }} disponibles.</p>
        <div v-if="release.collection.busy || release.collection.error || (release.collection.started ? release.collection.cursor : artist.expandable[release.kind])" class="catalog-more"><p v-if="release.collection.error" role="status">{{ release.collection.error }}</p><p v-if="release.collection.busy" role="status">Cargando {{ release.title.toLocaleLowerCase('es') }}…</p><button v-else class="button subtle" @click="release.collection.load(release.collection.expired)">{{ release.collection.error ? release.collection.expired ? `Actualizar ${release.title.toLocaleLowerCase('es')}` : `Reintentar ${release.title.toLocaleLowerCase('es')}` : `Ver más ${release.title.toLocaleLowerCase('es')}` }}</button></div>
      </section>

      <section v-if="artist.description" class="catalog-section" aria-labelledby="artist-about-title">
        <div class="section-heading"><h2 id="artist-about-title">Acerca de</h2></div>
        <div class="artist-about">
          <div class="artist-about-art" aria-hidden="true"><AlbumCover :src="artist.banner || artist.artwork" :size="1024" /></div>
          <p id="artist-biography" class="catalog-biography" :class="{ expanded: expandedBiography || artist.description.length <= 240 }">{{ artist.description }}</p>
          <button v-if="artist.description.length > 240" class="catalog-text-button biography-toggle" :aria-expanded="expandedBiography" aria-controls="artist-biography" @click="expandedBiography = !expandedBiography">{{ expandedBiography ? 'Mostrar menos' : 'Más información' }}</button>
        </div>
      </section>

      <section v-if="similar.length" class="catalog-section" aria-labelledby="artist-similar-title">
        <div class="section-heading"><h2 id="artist-similar-title">Fans también escuchan</h2></div>
        <div class="album-grid artist-similar-grid"><NuxtLink v-for="item in similar" :key="item.id" :to="`/music/artist/${item.id}`" class="album-card artist-card"><AlbumCover :src="item.artwork" :title="item.name" /><strong :title="item.name">{{ item.name }}</strong><span>Artista</span></NuxtLink></div>
      </section>
    </template>
  </div>
</template>
