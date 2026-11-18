<script setup lang="ts">
import type { LibraryItem, YouTubeSong } from '../../shared/types/music'
import type { ListeningContext } from '../../shared/types/telemetry'
/**
 * One song menu for every list, card and the expanded player, with the same actions in the same order.
 * On phones AppDialog presents it as a bottom sheet.
 */
const props = defineProps<{ item: LibraryItem | null; context?: ListeningContext; playlistId?: string }>()
const emit = defineEmits<{ close: [] }>()
const library = useLibraryStore(), player = usePlayerStore(), downloads = useDownloadsStore()
const router = useRouter()
const shown = ref<LibraryItem | null>(null)
// Keep the last song while the sheet closes, so its content does not blank out mid-animation.
watch(() => props.item, item => { if (item) shown.value = item }, { immediate: true })
const song = computed<YouTubeSong | null>(() => shown.value?.entry.source === 'youtube' ? shown.value.entry.song : null)
const favorite = computed(() => {
  const item = shown.value
  if (!item) return false
  return library.collectionMap.get(item.id)?.favorite ?? (song.value ? library.youtubeSongMap.get(song.value.videoId)?.favorite : undefined) ?? item.favorite
})
const downloaded = computed(() => !!shown.value && downloads.readyIds.has(shown.value.id))
const localTrack = computed(() => shown.value?.entry.source === 'local' ? library.trackMap.get(shown.value.entry.trackId) : undefined)
const canDownload = computed(() => song.value ? true : !!localTrack.value?.mobile)
const albumRoute = computed(() => {
  if (song.value) return song.value.albumId ? `/music/album/${song.value.albumId}` : null
  const id = shown.value?.albumId || localTrack.value?.albumId
  return id ? `/album/${encodeURIComponent(id)}` : null
})
const artistRoute = computed(() => {
  if (song.value) { const id = song.value.artistRefs?.find(artist => artist.id)?.id; return id ? `/music/artist/${id}` : null }
  const name = shown.value?.artist
  return name && name !== 'Artista desconocido' ? `/artist/${encodeURIComponent(name)}` : null
})
const playlist = computed(() => props.playlistId ? library.playlists.find(list => list.id === props.playlistId) : undefined)
const position = computed(() => shown.value && playlist.value ? playlist.value.trackIds.indexOf(shown.value.id) : -1)

function close() { emit('close') }
function toggleFavorite() {
  if (song.value) void library.favoriteYouTube(song.value)
  else if (shown.value) void library.favorite(shown.value.id)
  close()
}
function enqueue() {
  const entry = shown.value?.entry
  if (entry?.source === 'youtube') player.enqueueYouTube(entry.song, props.context)
  else if (entry) player.enqueue(entry.trackId, props.context)
  close()
}
function toggleDownload() {
  if (!shown.value) return
  if (downloaded.value) void downloads.remove(shown.value.id)
  else void downloads.downloadEntries([shown.value.entry])
  close()
}
/** From the expanded player, the destination replaces the player's history entry; Back then returns to the page beneath. */
async function go(path: string) {
  close()
  await navigateTo(path, { replace: router.currentRoute.value.query.overlay !== undefined })
  player.expanded = false
}
async function addTo(id: string) {
  const list = library.playlists.find(item => item.id === id)
  if (!list || !shown.value) return
  if (song.value) await library.addYouTubeToPlaylist(list, song.value)
  else if (!list.trackIds.includes(shown.value.id)) await library.updatePlaylist(list, { trackIds: [...list.trackIds, shown.value.id] })
  close()
}
async function editPlaylist(mode: 'remove' | 'up' | 'down') {
  const list = playlist.value, from = position.value
  if (!list || from < 0) return
  const ids = [...list.trackIds]
  if (mode === 'remove') ids.splice(from, 1)
  else {
    const to = from + (mode === 'up' ? -1 : 1)
    if (to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
  }
  await library.updatePlaylist(list, { trackIds: ids })
  close()
}
</script>

<template>
  <AppDialog :open="!!item" :title="shown?.title || 'Canción'" :subtitle="shown?.artist" class="song-sheet" @close="close">
    <template #lead><AlbumCover class="song-sheet-cover" :src="shown?.artwork" :title="shown?.album" :palette="shown?.palette" /></template>
    <template v-if="shown">
      <div class="menu-actions">
        <button class="menu-action" :disabled="!library.connected" @click="toggleFavorite"><OIcon name="heart" />{{ favorite ? 'Quitar de favoritos' : 'Añadir a favoritos' }}</button>
        <button class="menu-action" @click="enqueue"><OIcon name="queue" />Añadir a la cola</button>
        <button class="menu-action" :disabled="!downloaded && (!canDownload || !library.connected)" @click="toggleDownload"><OIcon :name="downloaded ? 'trash' : 'download'" />{{ downloaded ? 'Eliminar descarga de este dispositivo' : 'Descargar en este dispositivo' }}</button>
        <p v-if="song && library.youtubeSongMap.get(song.videoId)?.localAudio" class="muted small">Disponible en el PC</p>
        <button v-if="albumRoute" class="menu-action" @click="go(albumRoute)"><OIcon name="disc" />Ir al álbum</button>
        <button v-if="artistRoute" class="menu-action" @click="go(artistRoute)"><OIcon name="music" />Ir al artista</button>
        <template v-if="playlist && position >= 0">
          <button class="menu-action" :disabled="!library.connected" @click="editPlaylist('remove')"><OIcon name="trash" />Quitar de esta playlist</button>
          <button class="menu-action" :disabled="!library.connected || position === 0" @click="editPlaylist('up')"><OIcon name="up" />Mover hacia arriba</button>
          <button class="menu-action" :disabled="!library.connected || position === playlist.trackIds.length - 1" @click="editPlaylist('down')"><OIcon name="arrowDown" />Mover hacia abajo</button>
        </template>
      </div>
      <template v-if="library.playlists.length">
        <p class="muted small song-sheet-label">Añadir a una playlist</p>
        <button v-for="list in library.playlists" :key="list.id" class="menu-action" :disabled="!library.connected || list.trackIds.includes(shown.id)" @click="addTo(list.id)"><OIcon name="plus" />{{ list.name }}</button>
      </template>
    </template>
  </AppDialog>
</template>
