<script setup lang="ts">
import type { ListeningContext } from '../../../../shared/types/telemetry'
import type { YouTubeAlbumDetail } from '../../../../shared/types/music'
import { formatTime } from '../../../../shared/utils/media'
import { songCount } from '../../../../shared/utils/text'
const route = useRoute()
const { disconnected } = useMusicConnection()
const library = useLibraryStore()
const player = usePlayerStore()
const downloads = useDownloadsStore()
const { data: album, status, error, refresh } = await useFetch<YouTubeAlbumDetail>(() => `/api/music/albums/${encodeURIComponent(String(route.params.id))}`, { lazy: true, timeout: 20000, retry: 0 })
const loadError = computed(() => (error.value?.data as { message?: string } | undefined)?.message || 'No se pudo consultar este álbum.')
const artist = computed(() => album.value?.artists.find(item => item.id))
const cached = computed(() => downloads.collections[`album:${String(route.params.id)}`])
const visibleAlbum = computed(() => album.value || (cached.value ? { id: cached.value.id, title: cached.value.title,
  artists: [], artwork: cached.value.artwork, year: null, songs: cached.value.entries.flatMap(entry => entry.source === 'youtube' ? [entry.song] : []) } : null))
const listeningContext = computed<ListeningContext | undefined>(() => visibleAlbum.value ? { kind: 'album', id: 'youtube:' + visibleAlbum.value.id, title: visibleAlbum.value.title, subtitle: visibleAlbum.value.artists.map(artist => artist.name).join(', '), artwork: visibleAlbum.value.artwork } : undefined)
const duration = computed(() => visibleAlbum.value?.songs.reduce((sum, song) => sum + (song.duration || 0), 0) || 0)
useStartupContent(() => !!visibleAlbum.value || disconnected.value || status.value === 'success' || status.value === 'error')
watch(disconnected, value => { if (!value && (!album.value || error.value)) void refresh() })
useHead({ title: () => album.value ? `${album.value.title} · Openfy` : 'Álbum · Openfy' })
</script>

<template>
  <div class="page-content catalog-page">
    <DetailBar :title="visibleAlbum?.title" :fallback="artist?.id ? `/music/artist/${artist.id}` : '/search'" :labels="artist?.id ? { [`/music/artist/${artist.id}`]: artist.name } : {}" />
    <div v-if="!visibleAlbum && disconnected" class="empty-state" role="status"><OIcon name="offline" :size="44" /><h1>Conecta para abrir este álbum.</h1><p>Necesitas conexión con tu PC e Internet.</p><button class="button subtle" @click="library.refresh">Reintentar conexión</button></div>
    <div v-else-if="!visibleAlbum && (status === 'pending' || status === 'idle')" class="empty-state" role="status"><OIcon name="loading" class="spin" :size="36" /><p>Cargando álbum…</p></div>
    <div v-else-if="!visibleAlbum" class="empty-state" role="status"><h1>Álbum no disponible.</h1><p>{{ loadError }}</p><button class="button primary" @click="refresh()">Reintentar álbum</button></div>
    <template v-else>
      <header class="collection-header catalog-album-hero"><AlbumCover :src="visibleAlbum.artwork" :title="visibleAlbum.title" /><div><p class="greeting">YouTube Music</p><h1>{{ visibleAlbum.title }}</h1><p class="catalog-album-artists"><MusicArtistNames :artists="visibleAlbum.artists" /></p><p class="muted"><template v-if="visibleAlbum.year">{{ visibleAlbum.year }} · </template>{{ songCount(visibleAlbum.songs.length) }}<template v-if="duration"> · {{ formatTime(duration) }}</template></p><button class="button primary" :disabled="!visibleAlbum.songs.length" @click="player.playYouTube(visibleAlbum.songs, 0, listeningContext)"><OIcon name="play" :size="19" />Reproducir álbum</button></div></header>
      <DownloadCollectionButton kind="album" :id="visibleAlbum.id" :title="visibleAlbum.title" :artwork="visibleAlbum.artwork" :entries="visibleAlbum.songs.map(song => ({ source: 'youtube' as const, song }))" />
      <YouTubeTrackList v-if="visibleAlbum.songs.length" :context="listeningContext" :songs="visibleAlbum.songs" :label="`Canciones de ${visibleAlbum.title}`" />
      <div v-else class="empty-state" role="status"><h2>Este álbum no tiene pistas disponibles.</h2><p>Puedes explorar otros lanzamientos del artista.</p></div>
    </template>
  </div>
</template>
