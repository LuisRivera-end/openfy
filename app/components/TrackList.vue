<script setup lang="ts">
import type { LibraryItem, Track } from '../../shared/types/music'
import { formatTime } from '../../shared/utils/media'
const props = defineProps<{ tracks: Track[]; playlistId?: string }>()
const library = useLibraryStore()
const player = usePlayerStore()
const menuTrack = ref<Track | null>(null)
const count = ref(100)
watch(() => props.tracks, () => { count.value = 100 })
const displayed = computed(() => props.tracks.slice(0, count.value))
function play(track: Track) { player.playTracks(props.tracks.map(t => t.id), props.tracks.findIndex(t => t.id === track.id), { kind: 'song' }) }
const press = useLongPress()
/** The shared song menu works on library items; local tracks are already in the collection map. */
const menuItem = computed<LibraryItem | null>(() => menuTrack.value ? library.collectionMap.get(menuTrack.value.id) || { ...menuTrack.value, source: 'local', entry: { source: 'local', trackId: menuTrack.value.id } } : null)
</script>

<template>
  <div class="track-list" role="list" aria-label="Canciones">
    <div v-if="tracks.length" class="track-list-heading" aria-hidden="true"><span>#</span><span>Título</span><span>Álbum</span><span></span><span>Duración</span><span></span></div>
    <div v-for="(track, i) in displayed" :key="`${track.id}-${i}`" class="track-row" :class="{ selected: player.current?.id === track.id }" role="listitem" v-bind="press(() => menuTrack = track)">
      <span class="track-number">{{ i + 1 }}</span>
      <div class="track-title-cell">
        <button class="cover-play" :aria-label="`Reproducir ${track.title}`" @click="play(track)"><AlbumCover :src="track.artwork" :title="track.album" :palette="track.palette" /><span class="cover-play-icon"><OIcon name="play" :size="18" /></span></button>
        <div class="track-copy"><button class="track-title" @click="play(track)">{{ track.title }}</button><TrackArtistLink :entry="{ source: 'local', trackId: track.id }" :artist="track.artist" /></div>
        <DownloadIndicator :track-id="track.id" />
      </div>
      <NuxtLink class="track-album" :to="`/album/${track.albumId}`">{{ track.album }}</NuxtLink>
      <button class="icon-button favorite-action" :class="{ active: track.favorite }" :disabled="!library.connected" :aria-label="`${track.favorite ? 'Quitar de' : 'Añadir a'} favoritos: ${track.title}`" :aria-pressed="track.favorite" @click="library.favorite(track.id)"><OIcon name="heart" :size="18" /></button>
      <span class="track-duration">{{ formatTime(track.duration) }}</span>
      <button class="icon-button" :aria-label="`Opciones de ${track.title}`" @click="menuTrack = track"><OIcon name="more" /></button>
    </div>
    <button v-if="tracks.length > count" class="button subtle load-more" @click="count += 100">Mostrar más canciones</button>
  </div>
  <SongActionsSheet :item="menuItem" :context="{ kind: 'song' }" :playlist-id="playlistId" @close="menuTrack = null" />
</template>
