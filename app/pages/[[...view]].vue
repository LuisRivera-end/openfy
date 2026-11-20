<script setup lang="ts">
const sessionFile = ref<HTMLInputElement>()
async function selectSession(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) await player.importSession(input.files[0])
  input.value = ''
}
const updates = useUpdatesStore()
const releaseNotes = useReleaseNotesStore()
const release = useRuntimeConfig().public.release
import { formatBytes, formatTime } from '../../shared/utils/media'
import type { Track, LibraryItem } from '../../shared/types/music'
import type { LibrarySort, ListeningContext } from '../../shared/types/telemetry'
import { filterLibrary } from '../../shared/utils/library-filters'
import { playbackKey } from '../../shared/utils/playback'
import { countLabel, songCount } from '../../shared/utils/text'
const library = useLibraryStore()
const player = usePlayerStore()
const downloads = useDownloadsStore()
const route = useRoute()
const segments = computed(() => Array.isArray(route.params.view) ? route.params.view : [route.params.view || ''])
const section = computed(() => segments.value[0] || 'home')
const itemId = computed(() => segments.value[1] || '')
const filters = useLibraryFilters(() => route.path)
const telemetry = useTelemetryStore()
const query = computed({ get: () => filters.value.query, set: value => { filters.value.query = value } })
const tab = ref('songs')
const downloadedOnly = computed({ get: () => filters.value.downloaded, set: value => { filters.value.downloaded = value } })
const playlistEditor = ref(false)
const playlistTitle = ref('')
const removePlaylist = ref(false)
const playlistMenu = ref(false)
const playlistCover = (ids: string[]) => ids.map(id => library.collectionMap.get(id)?.artwork).find(Boolean)
const favoriteCount = computed(() => [...library.collectionMap.values()].filter(item => item.favorite).length)
const importOpen = useState('importOpen', () => false)
const playlistOpen = useState('playlistOpen', () => false)
const appearance = useAppearanceStore()
const motion = computed({ get: () => appearance.effects, set: value => appearance.effects = value })
const copying = ref(false)
const selectedAlbum = computed(() => library.albums.find(album => album.id === itemId.value))
const selectedArtist = computed(() => library.artists.find(artist => artist.name === itemId.value))
const libraryArtist = computed(() => section.value === 'artist' ? selectedArtist.value : undefined)
const libraryArtistTheme = useArtistTheme(() => libraryArtist.value?.artwork, () => libraryArtist.value ? 'local:artist:' + libraryArtist.value.name : undefined)
useArtistShellTheme(() => libraryArtist.value ? libraryArtistTheme.value : undefined)
const selectedPlaylist = computed(() => library.playlists.find(playlist => playlist.id === itemId.value))
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
const filteredTracks = computed(() => {
  return collectionItems.value.map(item => library.trackMap.get(item.id)).filter((track): track is Track => !!track)
})
const title = computed(() => ({ home: 'Tu música, a tu manera.', library: 'Tu biblioteca', search: 'Encuentra tu próxima canción', favorites: 'Tus favoritas', downloads: 'Siempre contigo', settings: 'Ajustes',
  album: selectedAlbum.value?.title || 'Álbum no disponible', artist: selectedArtist.value?.name || 'Artista no disponible', playlist: selectedPlaylist.value?.name || 'Playlist no disponible' })[section.value] || 'Página no encontrada')
const unfilteredItems = computed(() => {
  const albumSnapshot = downloads.collections[`album:${itemId.value.replace(/^youtube:/, '')}`]
  const ids = section.value === 'playlist' ? selectedPlaylist.value?.trackIds : section.value === 'album' ? albumSnapshot?.entries.map(playbackKey) || selectedAlbum.value?.trackIds : section.value === 'artist' ? selectedArtist.value?.trackIds : undefined
  if (['playlist', 'album', 'artist'].includes(section.value)) return (ids || []).map(id => library.collectionMap.get(id)).filter((item): item is LibraryItem => !!item)
  return [...library.collectionMap.values()].filter(item => section.value !== 'favorites' || item.favorite).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
})
const collectionItems = computed(() => filterLibrary(unfilteredItems.value, filters.value, telemetry.stats.byTrack, downloads.readyIds))
const visibleIds = computed(() => new Set(collectionItems.value.map(item => item.id)))
const visibleAlbums = computed(() => library.albums.map(album => ({ ...album, trackIds: album.trackIds.filter(id => visibleIds.value.has(id)) })).filter(album => album.trackIds.length > 0))
const visibleArtists = computed(() => library.artists.map(artist => ({ ...artist, trackIds: artist.trackIds.filter(id => visibleIds.value.has(id)) })).filter(artist => artist.trackIds.length > 0))
function sortCollection(key: LibrarySort) { if (filters.value.sort === key) filters.value.direction = filters.value.direction === 'asc' ? 'desc' : 'asc'; else { filters.value.sort = key; filters.value.direction = ['plays', 'minutes', 'addedAt'].includes(key) ? 'desc' : 'asc' } }
const collectionArtwork = computed(() => section.value === 'album' ? selectedAlbum.value?.artwork : section.value === 'artist' ? selectedArtist.value?.artwork : unfilteredItems.value[0]?.artwork)
const listeningContext = computed<ListeningContext | undefined>(() => {
  if (section.value === 'favorites') return { kind: 'favorites' }
  if (section.value === 'playlist' && selectedPlaylist.value) return { kind: 'playlist', id: selectedPlaylist.value.id }
  if (section.value === 'album' && selectedAlbum.value) return { kind: 'album', id: selectedAlbum.value.id, title: selectedAlbum.value.title, subtitle: selectedAlbum.value.artist, artwork: selectedAlbum.value.artwork }
  if (section.value === 'artist' && selectedArtist.value) return { kind: 'artist', id: selectedArtist.value.name, title: selectedArtist.value.name, subtitle: 'Artista', artwork: selectedArtist.value.artwork }
  if (section.value === 'search') return { kind: 'song' }
})
const detail = computed(() => ['album', 'artist', 'playlist', 'favorites'].includes(section.value))
const downloadEntries = computed(() => Object.values(downloads.records).sort((a, b) => b.updatedAt - a.updatedAt))
const preparing = computed(() => library.tracks.filter(track => track.conversion !== 'ready'))
watch(() => route.path, () => { tab.value = 'songs' })
async function renamePlaylist() {
  if (selectedPlaylist.value) await library.updatePlaylist(selectedPlaylist.value, { name: playlistTitle.value.trim() })
  playlistEditor.value = false
}
async function deletePlaylist() {
  if (selectedPlaylist.value) await library.deletePlaylist(selectedPlaylist.value.id)
  removePlaylist.value = false
  await navigateTo('/library')
}
async function resumeConversions() {
  if (player.playing) return
  try { await $fetch('/api/conversions', { method: 'POST' }); await library.refresh() }
  catch { library.error = 'No se pudo conectar con el PC.' }
}
async function copyAddress() {
  try { await navigator.clipboard.writeText(location.origin); copying.value = true }
  catch { library.error = 'Copia la dirección desde la barra del navegador.' }
}
</script>

<template>
  <div class="page-content" :class="{ 'library-artist-page': libraryArtist }" :style="libraryArtist ? { '--artist-base': libraryArtistTheme.base, '--artist-deep': libraryArtistTheme.deep, '--artist-surface': libraryArtistTheme.surface } : undefined">
    <HomePage v-if="section === 'home'" />

    <template v-else-if="section === 'downloads'">
      <DeviceDownloads />
    </template>

    <template v-else-if="section === 'settings'">
      <div class="page-heading"><div><p class="greeting">A tu manera</p><h1>Ajustes</h1></div></div>
      <section class="settings-panel"><h2>Actualizaciones</h2><div class="setting-row"><div><h3>Openfy {{ release.version }} · {{ release.build }}</h3><p role="status">{{ updates.status }}</p></div><div class="setting-actions"><button class="button subtle" @click="releaseNotes.history">Novedades</button><button class="button subtle" :disabled="updates.checking" @click="updates.check">Buscar actualizaciones</button></div></div></section>
      <section class="settings-panel"><h2>Tu biblioteca personal</h2><div class="setting-row"><div><h3>Conexión con tu PC</h3><p>{{ library.connected ? 'Disponible para importar, editar y escuchar.' : 'Las canciones descargadas siguen disponibles.' }}</p></div><button class="button subtle" @click="library.refresh"><OIcon name="refresh" :size="17" />Actualizar</button></div><div class="setting-row"><div><h3>Añadir música</h3><p>Los originales se conservan. Los FLAC tienen una versión AAC para el iPhone.</p></div><button class="button subtle" :disabled="!library.connected" @click="importOpen = true">Importar</button></div><div class="setting-row"><div><h3>Dirección de esta biblioteca</h3><p>Abre la misma dirección HTTPS en tus dispositivos.</p></div><button class="button subtle" @click="copyAddress">{{ copying ? 'Copiada' : 'Copiar dirección' }}</button></div></section>
      <section class="settings-panel"><h2>Reproducción y apariencia</h2><div class="setting-row"><div><h3>Movimiento ambiental</h3><p>Activa los fondos del reproductor y el movimiento de las cabeceras.</p></div><label class="switch"><input v-model="motion" type="checkbox" switch aria-label="Activar movimiento ambiental"><span></span></label></div><div class="setting-row"><div><h3>Portadas animadas</h3><p>Muestra vídeos en las cabeceras de artistas y en el reproductor compatible. El ahorro de datos mantiene la imagen fija cuando el navegador lo indica.</p></div><label class="switch"><input v-model="appearance.motionArt" type="checkbox" switch aria-label="Activar portadas animadas"><span></span></label></div><div class="setting-row"><div><h3>Descargas en este dispositivo</h3><p>{{ downloads.persistent ? 'El navegador ha concedido almacenamiento persistente.' : 'El navegador administra el espacio. Conserva siempre los originales en tu PC.' }}</p></div><NuxtLink class="button subtle" to="/downloads">Administrar</NuxtLink></div></section>
      <section v-if="preparing.length" class="settings-panel"><div class="section-heading"><h2>Preparando para tu iPhone</h2><button class="button subtle" :disabled="!library.connected || player.playing" @click="resumeConversions">Reanudar / reintentar</button></div><p v-if="library.conversionPaused" class="muted">Las conversiones están en pausa por reproducción. Si ya terminaste de escuchar en el otro dispositivo, puedes reanudarlas.</p><div v-for="track in preparing" :key="track.id" class="conversion-row"><strong>{{ track.title }}</strong><span>{{ track.conversion === 'failed' ? track.conversionError : track.conversion === 'running' ? `Convirtiendo ${track.conversionProgress} %` : 'En espera' }}</span></div></section>
      <section v-if="library.jobs.length" class="settings-panel"><h2>Últimas importaciones</h2><div v-for="job in library.jobs.slice(0, 20)" :key="job.id" class="conversion-row"><strong>{{ job.filename }}</strong><span>{{ job.state === 'complete' ? 'Importada' : job.state === 'duplicate' ? 'Ya estaba en tu biblioteca' : job.state === 'processing' ? 'Procesando' : job.error }}</span></div></section>
      <section class="settings-panel"><h2>Aplicación para Windows</h2><div class="setting-row"><div><h3>Sesión de escritorio</h3><p>Exporta la cola, la posición, el volumen y la preferencia de movimiento para importarlos en Openfy nativo. Tus descargas permanecen en este dispositivo.</p></div><div class="setting-actions"><button class="button subtle" @click="player.exportDesktopSession">Exportar sesión de escritorio</button><button class="button subtle" @click="sessionFile?.click()">Importar sesión</button></div></div><input ref="sessionFile" type="file" hidden accept=".json,application/json" @change="selectSession"></section>
      <details class="settings-panel validation-panel"><summary><h2>Diagnóstico y prueba en iPhone</h2></summary><p>Esta versión necesita comprobarse en tu iPhone con la pantalla bloqueada y tus audífonos. Reproduce diez canciones durante 45 minutos y repite la prueba en modo avión.</p><p>Después comprueba llamadas, Bluetooth, controles de audífonos y cambios de canción. El diagnóstico se guarda como un archivo local.</p><button class="button subtle" @click="player.exportDiagnostics"><OIcon name="download" :size="18" />Exportar diagnóstico</button><p class="small muted">Openfy {{ useRuntimeConfig().public.release.version }} · Validación de iPhone pendiente · {{ downloads.available ? 'Modo sin conexión preparado' : 'Instala la versión de producción para probar el modo sin conexión' }}</p></details>
    </template>

    <template v-else-if="['library', 'search', 'album', 'artist', 'playlist', 'favorites'].includes(section)">
      <DetailBar v-if="detail" phone-only :title="title" fallback="/library" />
      <CollectionHeader v-if="detail" :context="listeningContext" :title="title" :kind="section === 'playlist' ? 'Playlist personal' : section === 'favorites' ? 'Hecha por ti' : section === 'artist' ? 'Artista en tu biblioteca' : 'Álbum'" :items="unfilteredItems" :results="collectionItems" :artwork="collectionArtwork" :favorite="section === 'favorites'" :artist="section === 'artist'" :artist-theme="libraryArtist ? libraryArtistTheme : undefined" :subtitle="section === 'album' ? selectedAlbum?.artist : undefined">
        <DownloadCollectionButton v-if="section === 'playlist' && selectedPlaylist" kind="playlist" :id="selectedPlaylist.id" :title="selectedPlaylist.name" :entries="unfilteredItems.map(item => item.entry)" :artwork="collectionArtwork" />
        <DownloadCollectionButton v-else-if="section === 'album'" kind="album" :id="itemId" :title="title" :entries="unfilteredItems.map(item => item.entry)" :artwork="collectionArtwork" />
        <button v-else-if="section === 'favorites'" class="button subtle" aria-label="Descargar favoritas" :disabled="!unfilteredItems.length" @click="downloads.downloadEntries(unfilteredItems.map(item => item.entry))"><OIcon name="download" :size="18" /><span class="button-label">Descargar favoritas</span></button>
        <button v-else class="icon-button" aria-label="Descargar esta colección" :disabled="!unfilteredItems.length" @click="downloads.downloadEntries(unfilteredItems.map(item => item.entry))"><OIcon name="download" :size="20" /></button>
        <template v-if="section === 'playlist' && selectedPlaylist"><button class="button subtle desktop-only" :disabled="!library.connected" @click="playlistTitle = selectedPlaylist.name; playlistEditor = true">Editar nombre</button><button class="icon-button desktop-only" aria-label="Eliminar esta playlist" :disabled="!library.connected" @click="removePlaylist = true"><OIcon name="trash" :size="19" /></button><button class="icon-button phone-inline" aria-label="Opciones de la playlist" @click="playlistMenu = true"><OIcon name="more" :size="22" /></button></template>
      </CollectionHeader>
      <div v-else class="page-heading library-heading"><div><p class="greeting">{{ section === 'search' ? 'En tu colección' : 'Todo lo que te gusta, aquí' }}</p><h1>{{ title }}</h1></div><div v-if="section === 'library'" class="library-heading-actions"><button class="icon-button phone-inline" aria-label="Importar música" :disabled="!library.connected || library.importing" @click="importOpen = true"><OIcon name="upload" :size="21" /></button><button class="button subtle library-create" aria-label="Crear playlist" :disabled="!library.connected" @click="playlistOpen = true"><OIcon name="plus" :size="18" /><span class="button-label">Crear playlist</span></button></div></div>
      <CollectionPlaybackActions v-if="section === 'library' && tab === 'songs'" :items="collectionItems" class="library-playback-actions" />
      <nav v-if="section === 'library'" class="library-shortcuts phone-block" aria-label="Accesos de tu biblioteca"><NuxtLink to="/favorites" class="settings-entry"><AlbumCover favorite /><span class="track-copy"><strong>Tus favoritas</strong><span>{{ songCount(favoriteCount) }}</span></span><OIcon class="entry-chevron" name="forward" :size="18" /></NuxtLink><NuxtLink to="/most-played" class="settings-entry"><span class="download-cover"><OIcon name="headphones" :size="22" /></span><span class="track-copy"><strong>Más reproducidas</strong><span>Tu historial de escucha</span></span><OIcon class="entry-chevron" name="forward" :size="18" /></NuxtLink></nav>
      <div v-if="section === 'library'" class="library-toolbar"><div class="filter-chips" aria-label="Ver biblioteca por"><button :class="{ chosen: tab === 'songs' }" @click="tab = 'songs'">Canciones</button><button :class="{ chosen: tab === 'albums' }" @click="tab = 'albums'">Álbumes</button><button :class="{ chosen: tab === 'artists' }" @click="tab = 'artists'">Artistas</button><button :class="{ chosen: tab === 'playlists' }" @click="tab = 'playlists'">Playlists</button></div></div>
      <LibraryFilterBar v-if="!(section === 'library' && tab === 'playlists')" v-model="filters" :sortable="!(section === 'library' && tab !== 'songs')" :default-sort-label="section === 'playlist' ? 'Orden de la playlist' : section === 'album' ? 'Orden del álbum' : 'Añadidas recientemente'" :items="unfilteredItems" :count="collectionItems.length" :summary="section === 'library' && tab === 'albums' ? countLabel(visibleAlbums.length, 'álbum', 'álbumes') : section === 'library' && tab === 'artists' ? countLabel(visibleArtists.length, 'artista', 'artistas') : undefined" downloads />
      <div v-if="section === 'library' && tab === 'albums'" class="album-grid"><NuxtLink v-for="album in visibleAlbums" :key="album.id" :to="`/album/${encodeURIComponent(album.id)}`" class="album-card"><AlbumCover :src="album.artwork" :title="album.title" :palette="album.palette" /><strong>{{ album.title }}</strong><span>{{ album.artist }}</span></NuxtLink></div>
      <div v-else-if="section === 'library' && tab === 'playlists'" class="album-grid"><NuxtLink v-if="favoriteCount" to="/favorites" class="album-card"><AlbumCover favorite /><strong>Tus favoritas</strong><span>{{ songCount(favoriteCount) }}</span></NuxtLink><NuxtLink v-for="list in library.playlists" :key="list.id" :to="`/playlist/${encodeURIComponent(list.id)}`" class="album-card"><AlbumCover :src="playlistCover(list.trackIds)" :title="list.name" /><strong>{{ list.name }}</strong><span>{{ songCount(list.trackIds.length) }}</span></NuxtLink><div v-if="!library.playlists.length" class="empty-state library-playlists-empty"><OIcon name="queue" :size="42" /><h2>Un lugar para cada momento.</h2><p>Crea tu primera playlist y añade canciones desde sus opciones.</p><button class="button primary" :disabled="!library.connected" @click="playlistOpen = true">Crear playlist</button></div></div>
      <div v-else-if="section === 'library' && tab === 'artists'" class="album-grid"><NuxtLink v-for="artist in visibleArtists" :key="artist.name" :to="`/artist/${encodeURIComponent(artist.name)}`" class="album-card artist-card"><AlbumCover :src="artist.artwork" :title="artist.name" /><strong>{{ artist.name }}</strong><span>{{ songCount(artist.trackIds.length) }}</span></NuxtLink></div>
      <template v-else><CollectionTrackList :items="collectionItems" :context="listeningContext" :playlist-id="section === 'playlist' ? selectedPlaylist?.id : undefined" :sort="filters.sort" :direction="filters.direction" @sort="sortCollection" /><div v-if="!collectionItems.length && !library.loading" class="empty-state"><OIcon :name="downloadedOnly ? 'download' : section === 'favorites' ? 'heart' : section === 'search' ? 'search' : 'music'" :size="42" /><h2>{{ downloadedOnly ? 'No hay canciones descargadas que coincidan.' : query ? 'Ninguna canción coincide.' : section === 'favorites' ? 'Aquí van las que más te gustan.' : section === 'playlist' ? 'Esta playlist está esperando su primera canción.' : 'Tu colección empieza contigo.' }}</h2><p>{{ downloadedOnly ? 'Desactiva Solo descargadas para ver el resto de la colección.' : query ? 'Prueba con otro título, artista o álbum.' : section === 'playlist' ? 'Abre las opciones de una canción y añádela a esta playlist.' : section === 'favorites' ? 'Toca el corazón de cualquier canción para guardarla aquí.' : 'Importa tus archivos desde el PC para empezar a escuchar.' }}</p><button v-if="downloadedOnly" class="button subtle" @click="downloadedOnly = false">Mostrar todas las canciones</button><button v-else-if="!library.tracks.length && !query" class="button primary" :disabled="!library.connected" @click="importOpen = true">Importar música</button></div></template>
    </template>
    <div v-else class="empty-state"><h1>Página no encontrada</h1><NuxtLink class="button primary" to="/">Volver al inicio</NuxtLink></div>
  </div>
  <AppDialog :open="playlistEditor" title="Editar playlist" @close="playlistEditor = false"><form @submit.prevent="renamePlaylist"><label for="rename">Nombre</label><input id="rename" v-model="playlistTitle" maxlength="100" required><button class="button primary" :disabled="!playlistTitle.trim()" type="submit">Guardar nombre</button></form></AppDialog>
  <AppDialog :open="playlistMenu" :title="selectedPlaylist?.name || 'Playlist'" subtitle="Playlist personal" @close="playlistMenu = false"><div class="menu-actions"><button class="menu-action" :disabled="!library.connected" @click="playlistMenu = false; playlistTitle = selectedPlaylist?.name || ''; playlistEditor = true"><OIcon name="edit" />Editar nombre</button><button class="menu-action" :disabled="!library.connected" @click="playlistMenu = false; removePlaylist = true"><OIcon name="trash" />Eliminar playlist</button></div></AppDialog>
  <AppDialog :open="removePlaylist" title="Eliminar playlist" @close="removePlaylist = false"><p>¿Eliminar «{{ selectedPlaylist?.name }}»? Tus archivos musicales se conservarán.</p><button class="button danger" @click="deletePlaylist">Eliminar playlist</button></AppDialog>
</template>
