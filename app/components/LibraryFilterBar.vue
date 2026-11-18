<script setup lang="ts">
import type { LibraryItem } from '../../shared/types/music'
import type { LibraryFilters, LibrarySort } from '../../shared/types/telemetry'
import { defaultLibraryFilters } from '../../shared/utils/library-filters'
import { songCount } from '../../shared/utils/text'
const props = defineProps<{ items: LibraryItem[]; count: number; downloads?: boolean; ranking?: boolean; summary?: string; sortable?: boolean; defaultSortLabel?: string }>()
defineOptions({ inheritAttrs: false })
const filters = defineModel<LibraryFilters>({ required: true })
const expanded = ref(false)
/** Phones have no column headers, so ordering lives in a sheet. Choosing the current order flips its direction. */
const sorting = ref(false)
const sorts = computed<[LibrarySort, string][]>(() => [['default', props.defaultSortLabel || 'Orden original'], ['title', 'Título'], ['artist', 'Artista'], ['album', 'Álbum'], ['duration', 'Duración'], ['plays', 'Reproducciones'], ['minutes', 'Minutos escuchados']])
function sortBy(key: LibrarySort) {
  if (filters.value.sort === key && key !== 'default') filters.value.direction = filters.value.direction === 'asc' ? 'desc' : 'asc'
  else { filters.value.sort = key; filters.value.direction = ['plays', 'minutes', 'addedAt'].includes(key) ? 'desc' : 'asc' }
  sorting.value = false
}
const artists = computed(() => [...new Set(props.items.map(item => item.artist))].sort((a, b) => a.localeCompare(b, 'es')))
const albums = computed(() => [...new Set(props.items.map(item => item.album))].sort((a, b) => a.localeCompare(b, 'es')))
const genres = computed(() => [...new Set(props.items.flatMap(item => item.genres?.length ? item.genres : ['Sin género']))].sort((a, b) => a.localeCompare(b, 'es')))
</script>
<template>
  <div v-bind="$attrs" class="collection-filters" :class="{ 'is-expanded': expanded, 'collection-toolbar': !ranking }" role="search" aria-label="Filtros de biblioteca">
    <div class="search-field"><OIcon name="search" :size="18" /><input v-model="filters.query" aria-label="Filtrar canciones" placeholder="Buscar en esta colección"><button v-if="filters.query" type="button" class="icon-button" aria-label="Borrar búsqueda" @click="filters.query = ''"><OIcon name="close" :size="16" /></button></div>
    <button v-if="ranking" class="button subtle library-filter-toggle" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? 'Ocultar filtros' : 'Filtros y ordenación' }}</button>
    <div v-if="ranking" class="collection-filter-controls">
      <label>Artista<select v-model="filters.artist" aria-label="Filtrar por artista"><option value="">Todos los artistas</option><option v-for="artist in artists" :key="artist">{{ artist }}</option></select></label>
      <label>Álbum<select v-model="filters.album" aria-label="Filtrar por álbum"><option value="">Todos los álbumes</option><option v-for="album in albums" :key="album">{{ album }}</option></select></label>
      <label>Género<select v-model="filters.genre" aria-label="Filtrar por género"><option value="">Todos los géneros</option><option v-for="genre in genres" :key="genre">{{ genre }}</option></select></label>
      <label>Origen<select v-model="filters.source" aria-label="Filtrar por origen"><option value="all">Todas las fuentes</option><option value="local">Archivos locales</option><option value="youtube">YouTube Music</option></select></label>
    </div>
    <template v-if="!ranking"><button v-if="sortable" type="button" class="button subtle collection-sort phone-inline" :aria-label="`Ordenar: ${sorts.find(([key]) => key === filters.sort)?.[1] || 'Orden original'}`" @click="sorting = true"><OIcon name="sort" :size="18" /><span class="collection-sort-label">{{ sorts.find(([key]) => key === filters.sort)?.[1] || 'Orden original' }}</span></button><button v-if="downloads" type="button" class="button subtle collection-download-filter" :class="{ chosen: filters.downloaded }" aria-label="Solo descargadas" :aria-pressed="filters.downloaded" @click="filters.downloaded = !filters.downloaded"><OIcon name="download" :size="18" /><span class="button-label">Solo descargadas</span></button><span class="collection-result-count" role="status">{{ summary || (filters.query.trim() || filters.downloaded ? `${count} de ${songCount(items.length)}` : songCount(count)) }}</span></template>
    <div v-else class="collection-filter-summary"><label><input v-model="filters.favorite" type="checkbox">Solo favoritas</label><span role="status">{{ songCount(count) }}</span><button class="catalog-text-button" @click="filters = defaultLibraryFilters()">Limpiar filtros</button></div>
  </div>
  <AppDialog v-if="sortable" :open="sorting" title="Ordenar canciones" @close="sorting = false"><div class="menu-actions" role="group" aria-label="Orden"><button v-for="[key, label] in sorts" :key="key" class="menu-action sort-option" :aria-pressed="filters.sort === key" @click="sortBy(key)"><OIcon :name="filters.sort === key ? 'check' : 'sort'" />{{ label }}<span v-if="filters.sort === key && key !== 'default'" class="sort-direction">{{ filters.direction === 'desc' ? 'Descendente' : 'Ascendente' }}</span></button></div></AppDialog>
</template>
