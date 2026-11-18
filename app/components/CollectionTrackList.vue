<script setup lang="ts">
import type { LibraryItem } from '../../shared/types/music'
import { formatTime } from '../../shared/utils/media'
import type { LibrarySort, ListeningContext, TrackStatistics } from '../../shared/types/telemetry'
import { defaultLibraryFilters, filterLibrary } from '../../shared/utils/library-filters'
const props = defineProps<{ items: LibraryItem[]; context?: ListeningContext; playlistId?: string; statistics?: Record<string, TrackStatistics>; sort?: LibrarySort; direction?: 'asc' | 'desc'; ranking?: boolean }>()
const emit = defineEmits<{ sort: [key: LibrarySort] }>()
const library = useLibraryStore()
const player = usePlayerStore()
const downloads = useDownloadsStore()
const telemetry = useTelemetryStore()
const statistics = computed(() => props.statistics || telemetry.stats.byTrack)
const localSort = ref<LibrarySort>('default'), localDirection = ref<'asc' | 'desc'>('asc')
const visibleItems = computed(() => filterLibrary(props.items.map(item => ({ ...item, favorite: library.collectionMap.get(item.id)?.favorite ?? item.favorite })), { ...defaultLibraryFilters(), sort: props.sort === undefined ? localSort.value : 'default', direction: localDirection.value }, statistics.value))
function order(key: LibrarySort) { if (props.sort === undefined) { localDirection.value = localSort.value === key ? localDirection.value === 'asc' ? 'desc' : 'asc' : ['plays', 'minutes'].includes(key) ? 'desc' : 'asc'; localSort.value = key }; emit('sort', key) }
const columns: [LibrarySort, string, string][] = [['title', 'Título', 'song-title-heading'], ['duration', 'Duración', 'song-duration-cell'], ['artist', 'Artista', 'song-artist-cell'], ['album', 'Álbum', 'song-album-cell'], ['genre', 'Género', 'song-genre-cell'], ['favorite', 'Favorito', 'song-favorite-cell'], ['plays', 'Reproducciones', 'song-plays-cell'], ['minutes', 'Minutos', 'song-minutes-cell']]
function favorite(item: LibraryItem) { if (item.entry.source === 'youtube') void library.favoriteYouTube(item.entry.song); else void library.favorite(item.id) }
const menu = ref<LibraryItem | null>(null)
/** Phones show one statistic beside the title, and only when the list is ordered by it. */
const phoneStat = computed(() => { const key = props.sort ?? localSort.value; return key === 'minutes' ? 'minutes' : key === 'plays' || props.ranking ? 'plays' : null })
const count = ref(100)
watch(() => props.items, () => { count.value = 100 })
function play(index: number) { player.playEntries(visibleItems.value.map(item => item.entry), index, props.context) }
const press = useLongPress()
</script>

<template>
  <div class="track-list collection-table" :class="phoneStat && `phone-stat-${phoneStat}`" role="list" aria-label="Canciones">
    <div v-if="items.length" class="track-list-heading"><span>#</span><button v-for="[key, label, className] in columns" :key="key" :class="className" :disabled="ranking && !['plays', 'minutes'].includes(key)" :aria-label="`Ordenar por ${label.toLocaleLowerCase('es')}`" :aria-pressed="(sort || localSort) === key" @click="order(key)">{{ key === 'favorite' ? '☆' : label }}<span v-if="(sort || localSort) === key">{{ (direction || localDirection) === 'desc' ? ' ↓' : ' ↑' }}</span></button><span></span></div>
    <div v-for="(item, i) in visibleItems.slice(0, count)" :key="`${item.id}:${i}`" class="track-row" :class="{ selected: player.current?.id === item.id }" role="listitem" v-bind="press(() => menu = item)">
      <span class="track-number">{{ i + 1 }}</span>
      <div class="track-title-cell"><button class="cover-play" :aria-label="`Reproducir ${item.title}`" @click="play(i)"><AlbumCover :src="item.artwork" :title="item.album" :palette="item.palette" /><span class="cover-play-icon"><OIcon name="play" :size="18" /></span></button><div class="track-copy"><button class="track-title" @click="play(i)">{{ item.title }}</button><TrackArtistLink :entry="item.entry" :artist="item.artist" /></div><DownloadIndicator :track-id="item.id" /></div>
      <span class="song-duration-cell">{{ formatTime(item.duration) }}</span>
      <span class="song-artist-cell" :title="item.artist"><TrackArtistLink :entry="item.entry" :artist="item.artist" /></span>
      <span class="song-album-cell" :title="item.album"><TrackAlbumLink :entry="item.entry" :album="item.album" :album-id="item.albumId" /></span>
      <span class="song-genre-cell" :title="item.genres?.join(', ') || 'Sin género'">{{ item.genres?.join(', ') || 'Sin género' }}</span>
      <button class="icon-button favorite-action song-favorite-cell" :class="{ active: item.favorite }" :disabled="!library.connected" :aria-label="`${item.favorite ? 'Quitar de' : 'Añadir a'} favoritos: ${item.title}`" :aria-pressed="item.favorite" @click="favorite(item)"><OIcon name="heart" :size="18" /></button>
      <span class="song-plays-cell" :aria-label="`${statistics[item.id]?.plays || 0} reproducciones`">{{ (statistics[item.id]?.plays || 0).toLocaleString('es-MX') }}</span>
      <span class="song-minutes-cell">{{ ((statistics[item.id]?.listenedMs || 0) / 60000).toLocaleString('es-MX', { maximumFractionDigits: 1 }) }}</span>
      <button class="icon-button" :aria-label="`Opciones de ${item.title}`" @click="menu = item"><OIcon name="more" /></button>
    </div>
    <button v-if="items.length > count" class="button subtle load-more" @click="count += 100">Mostrar más canciones</button>
  </div>
  <SongActionsSheet :item="menu" :context="context" :playlist-id="playlistId" @close="menu = null" />
</template>
