<script setup lang="ts">
import type { ListeningContext } from '../../shared/types/telemetry'
import type { LibraryItem, YouTubeSong } from '../../shared/types/music'
import { describePlayback } from '../../shared/utils/playback'
import { formatTime } from '../../shared/utils/media'
/** `start`/`end` show part of the list; playback always queues the whole list from the tapped song. */
const props = withDefaults(defineProps<{ songs: YouTubeSong[]; label?: string; disabled?: boolean; context?: ListeningContext; start?: number; end?: number; compact?: boolean }>(), { context: () => ({ kind: 'song' }), start: 0, end: undefined })
const player = usePlayerStore()
const library = useLibraryStore()
const menuSong = ref<YouTubeSong | null>(null)
const press = useLongPress()
const menuItem = computed<LibraryItem | null>(() => {
  if (!menuSong.value) return null
  const entry = { source: 'youtube' as const, song: menuSong.value }
  return { ...describePlayback(entry, library.trackMap)!, entry }
})
const shown = computed(() => props.songs.slice(props.start, props.end).map((song, i) => ({ song, index: props.start + i })))
</script>

<template>
  <div class="track-list youtube-list" :class="{ 'search-compact': compact }" role="list" :aria-label="label || 'Canciones de YouTube Music'">
    <div class="track-list-heading" aria-hidden="true"><span>#</span><span>Título</span><span>Álbum</span><span>Duración</span><span></span></div>
    <div v-for="{ song, index: i } in shown" :key="song.videoId" class="track-row" :class="{ selected: player.current?.id === `youtube:${song.videoId}` }" role="listitem" v-bind="disabled ? {} : press(() => menuSong = song)">
      <span class="track-number">{{ i + 1 }}</span>
      <div class="track-title-cell"><button class="cover-play" :disabled="disabled" :aria-label="`Reproducir ${song.title}`" @click="player.playYouTube(songs, i, context)"><AlbumCover :src="song.artwork" :title="song.album || song.title" /><span class="cover-play-icon"><OIcon name="play" :size="18" /></span></button><div class="track-copy"><button class="track-title" :disabled="disabled" @click="player.playYouTube(songs, i, context)">{{ song.title }}</button><MusicArtistNames :artists="song.artistRefs" :names="song.artists" /></div><DownloadIndicator :track-id="`youtube:${song.videoId}`" /></div>
      <NuxtLink v-if="song.albumId" class="track-album album-link" :to="`/music/album/${song.albumId}`">{{ song.album || 'Álbum' }}</NuxtLink><span v-else class="track-album">{{ song.album || '—' }}</span><span class="track-duration">{{ player.songDuration(song) === null ? '—' : formatTime(player.songDuration(song)!) }}</span>
      <div class="song-actions">
        <button class="icon-button favorite-action" :class="{ active: library.youtubeSongMap.get(song.videoId)?.favorite }" :disabled="disabled || !library.connected" :aria-label="`${library.youtubeSongMap.get(song.videoId)?.favorite ? 'Quitar de' : 'Añadir a'} favoritos: ${song.title}`" :aria-pressed="library.youtubeSongMap.get(song.videoId)?.favorite || false" @click="library.favoriteYouTube(song)"><OIcon name="heart" :size="18" /></button>
        <button class="icon-button queue-action" :disabled="disabled" :aria-label="`Añadir a la cola: ${song.title}`" @click="player.enqueueYouTube(song, context)"><OIcon name="plus" :size="19" /></button>
        <button class="icon-button" :disabled="disabled" :aria-label="`Opciones de ${song.title}`" @click="menuSong = song"><OIcon name="more" :size="19" /></button>
      </div>
    </div>
  </div>
  <SongActionsSheet :item="menuItem" :context="context" @close="menuSong = null" />
</template>

<style scoped>
.youtube-list .track-row, .youtube-list .track-list-heading { grid-template-columns: 28px minmax(150px, 2fr) minmax(100px, 1fr) 60px 126px; }
.youtube-list .track-row { border-bottom: 1px solid var(--album-surface, transparent); }
@media (hover: hover) { .youtube-list .track-row:hover { background: var(--album-surface, #ffffff07); } }
.youtube-list .track-row.selected { background: var(--album-surface, #ffffff04); }
.youtube-list :is(.track-number, .track-album, .track-duration, .track-list-heading span) { color: var(--album-muted, var(--muted)); }
.song-actions { display: flex; align-items: center; }
.search-compact .track-list-heading, .search-compact .track-number, .search-compact .track-album { display: none; }
.search-compact .track-row { grid-template-columns: minmax(0, 1fr) 50px 44px; gap: 8px; }
.search-compact .favorite-action, .search-compact .queue-action { display: none; }
@media (hover: hover) { .album-link:hover { color: #f4f4f5; text-decoration: underline; } }
/* Phones: the title gets the row; duration, favourite and queue are in the song's options. */
@media (max-width: 760px), (pointer: coarse) and (max-height: 500px) {
  .youtube-list .track-row, .youtube-list .track-list-heading { grid-template-columns: minmax(0, 1fr) 44px; gap: 6px; padding-left: 0; padding-right: 0; }
  .favorite-action, .queue-action { display: none; }
  .youtube-list .track-number, .youtube-list .track-album, .youtube-list .track-duration, .youtube-list .track-list-heading { display: none; }
}
</style>
