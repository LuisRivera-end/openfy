<script setup lang="ts">
import type { ListeningPeriod, ListeningStats, MostPlayedPage, LibrarySort } from '../../shared/types/telemetry'
import { parseListeningPeriod } from '../../shared/utils/telemetry-period'
import { readLocal, writeLocal } from '../lib/local'
const library = useLibraryStore(), telemetry = useTelemetryStore(), route = useRoute()
const period = ref<ListeningPeriod>(parseListeningPeriod(route.query.period))
const filters = useLibraryFilters('most-played')
const page = ref<MostPlayedPage>({ items: [], total: 0, offset: 0, limit: 50 })
const busy = ref(false), error = ref('')
const summary = ref<ListeningStats | null>(null)
let summaryGeneration = 0
async function loadSummary() {
  const own = ++summaryGeneration, key = `listening-summary:${period.value}`
  const cached = await readLocal<ListeningStats>(key).catch(() => null)
  if (own !== summaryGeneration) return
  summary.value = cached || null
  if (!library.connected) return
  try {
    const result = await $fetch<ListeningStats>('/api/telemetry/stats', { query: { period: period.value }, retry: 0 })
    if (own !== summaryGeneration) return
    summary.value = result; await writeLocal(key, result).catch(() => {})
  } catch { /* Keep the synchronized period summary. */ }
}
let generation = 0
const sort = computed(() => filters.value.sort === 'minutes' ? 'minutes' : 'plays')
const cacheKey = () => `listening-ranking:${period.value}:${JSON.stringify(filters.value)}`
async function load(more = false) {
  const own = ++generation
  busy.value = true; error.value = ''
  const key = cacheKey()
  const cached = !more ? await readLocal<MostPlayedPage>(key).catch(() => undefined) : null
  if (own !== generation) return
  if (!more) page.value = cached || { items: [], total: 0, offset: 0, limit: 50 }
  if (!library.connected) { busy.value = false; return }
  try {
    const result = await $fetch<MostPlayedPage>('/api/telemetry/top', { query: { ...filters.value, favorite: String(filters.value.favorite), period: period.value, sort: sort.value, offset: more ? page.value.items.length : 0, limit: 50 }, retry: 0 })
    if (own !== generation) return
    page.value = { ...result, items: more ? [...page.value.items, ...result.items] : result.items }
    await writeLocal(key, page.value)
  } catch { if (own === generation) error.value = 'No se pudo actualizar el ranking. Vuelve a intentarlo.' }
  finally { if (own === generation) busy.value = false }
}
const items = computed(() => page.value.items.map(row => row.item))
const statistics = computed(() => Object.fromEntries(page.value.items.map(row => [row.item.id, row])))
function order(key: LibrarySort) { if (key === 'plays' || key === 'minutes') filters.value.sort = key }
onMounted(() => { void useStartupStore().track(Promise.all([load(), loadSummary()])) })
watch([period, () => library.connected, () => telemetry.stats], () => { void loadSummary() })
watch([period, filters, () => library.connected, () => telemetry.stats], () => { void load() }, { deep: true })
</script>
<template>
  <div class="page-content"><DetailBar phone-only title="Tus más reproducidas" fallback="/library" /><div class="page-heading"><div><p class="greeting">Tu historial de escucha</p><h1>Tus más reproducidas</h1><p class="muted">Una reproducción cuenta al escuchar el 90 % de la canción.</p></div><select v-model="period" class="period-select" aria-label="Período del ranking"><option value="7d">Últimos 7 días</option><option value="30d">Últimos 30 días</option><option value="year">Este año</option><option value="all">Todo el historial</option></select></div>
    <ListeningSummary :summary="summary" />
    <LibraryFilterBar v-model="filters" :items="[...library.collectionMap.values(), ...items]" :count="page.total" ranking />
    <div class="ranking-order"><label>Orden del ranking<select v-model="filters.sort" aria-label="Ordenar ranking"><option value="plays">Reproducciones</option><option value="minutes">Minutos escuchados</option><option value="default">Más reproducidas</option></select></label></div>
    <p v-if="error" role="status" class="muted">{{ error }} <button class="catalog-text-button" @click="load()">Reintentar</button></p>
    <CollectionTrackList :items="items" :statistics="statistics" :sort="sort" direction="desc" ranking @sort="order" />
    <p v-if="!items.length && !busy" class="muted listening-empty">{{ filters.query || filters.artist || filters.album || filters.genre || filters.source !== 'all' || filters.favorite ? 'Ninguna canción coincide con estos filtros.' : 'Todavía no hay canciones para este período. Tu próxima escucha aparecerá aquí.' }}</p>
    <button v-if="items.length < page.total" class="button subtle load-more" :disabled="busy" @click="load(true)">{{ busy ? 'Cargando…' : 'Cargar 50 canciones más' }}</button>
  </div>
</template>
