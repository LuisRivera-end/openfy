<script setup lang="ts">
import { searchCategories, type SearchCategory } from '../stores/search'
definePageMeta({ keepalive: true })
const search = useSearchStore()
const library = useLibraryStore()
const loadMoreTrigger = ref<HTMLElement>()
let observer: IntersectionObserver | undefined, resizeObserver: ResizeObserver | undefined
let restoring = false, live = false
const bucket = computed(() => search.category === 'all' ? null : search.buckets[search.category])
function recordPosition() { if (live && !restoring) search.positions[search.category] = window.scrollY }
async function restorePosition() {
  restoring = true; await nextTick()
  requestAnimationFrame(() => { if (live) window.scrollTo(0, search.positions[search.category]); restoring = false; void checkForMore() })
}
function selectCategory(category: SearchCategory) { if (search.category !== category) { recordPosition(); search.category = category; void restorePosition() } }
function moveCategory(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = searchCategories.findIndex(item => item.key === search.category)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? searchCategories.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + searchCategories.length) % searchCategories.length
  const category = searchCategories[next]!.key
  selectCategory(category); document.getElementById(`search-tab-${category}`)?.focus()
}
async function checkForMore() {
  await nextTick()
  if (!live || restoring || search.disconnected || !library.connected || !loadMoreTrigger.value || search.category === 'all' || !bucket.value?.cursor || bucket.value.status !== 'success' || bucket.value.error) return
  const bounds = loadMoreTrigger.value.getBoundingClientRect()
  if (bounds.top <= window.innerHeight + 280 && bounds.bottom >= 0) { await search.load(search.category); if (live) void checkForMore() }
}
watch(loadMoreTrigger, target => { observer?.disconnect(); if (target) observer?.observe(target); void checkForMore() }, { flush: 'post' })
watch(() => [bucket.value?.status, bucket.value?.cursor], () => { void checkForMore() }, { flush: 'post' })
watch(() => search.query, () => { if (live) window.scrollTo(0, 0) })
function updateOnline() { search.online = navigator.onLine }
function activate() { if (live) return; live = true; search.activate(); void restorePosition(); if (loadMoreTrigger.value) observer?.observe(loadMoreTrigger.value) }
onMounted(() => {
  observer = new IntersectionObserver(() => { void checkForMore() }, { rootMargin: '0px 0px 280px 0px' })
  resizeObserver = new ResizeObserver(() => { void checkForMore() }); resizeObserver.observe(document.documentElement)
  window.addEventListener('scroll', recordPosition, { passive: true }); window.addEventListener('resize', checkForMore)
  window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline)
  updateOnline(); activate()
})
onActivated(activate)
onDeactivated(() => { recordPosition(); live = false; search.deactivate(); observer?.disconnect() })
onBeforeUnmount(() => {
  live = false; search.deactivate(); observer?.disconnect(); resizeObserver?.disconnect()
  window.removeEventListener('scroll', recordPosition); window.removeEventListener('resize', checkForMore)
  window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline)
})
</script>

<template>
  <div class="page-content music-search">
    <h1 class="sr-only">Buscar música</h1>
    <div class="filter-chips search-categories" role="tablist" aria-label="Categorías de búsqueda" @keydown="moveCategory">
      <button v-for="tab in searchCategories" :id="`search-tab-${tab.key}`" :key="tab.key" role="tab" aria-controls="youtube-results" :aria-selected="search.category === tab.key" :tabindex="search.category === tab.key ? 0 : -1" :class="{ chosen: search.category === tab.key }" @click="selectCategory(tab.key)">{{ tab.label }}</button>
    </div>
    <section id="youtube-results" role="tabpanel" :aria-labelledby="`search-tab-${search.category}`">
      <div v-if="search.disconnected" class="empty-state" role="status"><OIcon name="offline" :size="44" /><h2>Conecta para descubrir música.</h2><p>Necesitas conexión con tu PC e Internet. Tus descargas siguen en tu biblioteca.</p><button class="button subtle" @click="library.refresh">Reintentar conexión</button></div>
      <div v-else-if="!search.valid" class="empty-state"><OIcon name="search" :size="44" /><h2>¿Qué quieres escuchar?</h2><p>Escribe al menos dos caracteres para encontrar canciones, artistas o álbumes.</p></div>
      <template v-else-if="search.category === 'all'">
        <div class="search-overview">
          <section class="search-featured" aria-labelledby="search-featured-title">
            <div class="section-heading"><h2 id="search-featured-title">Resultado más relevante</h2></div>
            <p v-if="!search.settled" class="muted" role="status">Buscando coincidencias…</p>
            <SearchFeatured v-else-if="search.featured" :featured="search.featured" />
            <p v-else class="muted">No hay coincidencias disponibles. Prueba con otra búsqueda.</p>
          </section>
          <section aria-labelledby="search-songs-title"><div class="section-heading"><h2 id="search-songs-title">Canciones</h2><button class="search-see-all" @click="selectCategory('song')">Ver todas</button></div><YouTubeTrackList v-if="search.songs.length" :songs="search.songs" :end="4" compact label="Canciones principales de YouTube Music" /><SearchResultStatus kind="song" /></section>
        </div>
        <section class="search-preview" aria-labelledby="search-artists-title"><div class="section-heading"><h2 id="search-artists-title">Artistas</h2><button class="search-see-all" @click="selectCategory('artist')">Ver todos</button></div><SearchArtistGrid :artists="search.artists.slice(0, 6)" class="search-rail" /><SearchResultStatus kind="artist" /></section>
        <section class="search-preview" aria-labelledby="search-albums-title"><div class="section-heading"><h2 id="search-albums-title">Álbumes</h2><button class="search-see-all" @click="selectCategory('album')">Ver todos</button></div><MusicReleaseGrid :albums="search.albums.slice(0, 6)" show-artist class="search-rail" /><SearchResultStatus kind="album" /></section>
      </template>
      <template v-else>
        <YouTubeTrackList v-if="search.category === 'song' && search.songs.length" :songs="search.songs" />
        <SearchArtistGrid v-else-if="search.category === 'artist'" :artists="search.artists" />
        <MusicReleaseGrid v-else-if="search.category === 'album'" :albums="search.albums" show-artist />
        <div ref="loadMoreTrigger" class="search-more" data-testid="search-more"><SearchResultStatus :kind="search.category" end /></div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.music-search { container-type: inline-size; }
.search-categories { position: sticky; top: var(--search-header-height, 80px); z-index: 25; padding-block: 12px; margin: -12px 0 24px; background: var(--surface); overflow-x: auto; }
.search-categories button { flex: 0 0 auto; }
.search-overview { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; margin-bottom: 32px; }
@container (min-width: 800px) { .search-overview { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); } }
.search-preview { margin-block: 32px; }
.search-see-all { color: var(--muted); min-height: 44px; padding-inline: 8px; font-size: 13px; }
.search-see-all:hover { color: #f4f4f5; text-decoration: underline; }
.search-rail { display: grid; grid-auto-flow: column; grid-template-columns: none; grid-auto-columns: 165px; overflow-x: auto; padding-block: 4px 12px; gap: 20px; }
.search-more { min-height: 1px; padding-block: 12px; }
:deep(.search-status p) { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
:deep(.search-status button) { margin-top: 12px; }
@media (max-width: 760px), (pointer: coarse) and (max-height: 500px) {
  .search-categories { margin-bottom: 16px; gap: 6px; }
  .search-categories button { flex: 0 0 auto; padding-inline: 14px; }
  .search-rail { grid-auto-columns: 145px; gap: 12px; }
}
</style>
