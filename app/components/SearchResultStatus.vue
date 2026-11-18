<script setup lang="ts">
import type { SearchKind } from '../stores/search'
const props = defineProps<{ kind: SearchKind; end?: boolean }>()
const search = useSearchStore()
const bucket = computed(() => search.buckets[props.kind])
const names = { song: 'canciones', artist: 'artistas', album: 'álbumes' }
async function retry() { const refresh = bucket.value.expired; await search.load(props.kind, refresh); if (refresh && bucket.value.status === 'success' && search.category === props.kind) window.scrollTo(0, 0) }
</script>

<template>
  <div class="search-status" :aria-busy="bucket.status === 'loading'">
    <p v-if="bucket.status === 'idle' || bucket.status === 'loading'" role="status"><OIcon name="loading" class="spin" :size="20" /> {{ bucket.items.length ? 'Cargando más' : 'Buscando' }} {{ names[kind] }}…</p>
    <template v-else-if="bucket.error"><p role="status">{{ bucket.error }}</p><button class="button subtle" @click="retry">{{ bucket.expired ? 'Actualizar búsqueda' : bucket.items.length ? 'Reintentar carga' : 'Reintentar búsqueda' }}</button></template>
    <p v-else-if="!bucket.items.length" role="status">No hay {{ names[kind] }} que coincidan. Prueba con otro título o artista.</p>
    <p v-else-if="end && !bucket.cursor" role="status">No hay más {{ names[kind] }} para esta búsqueda.</p>
  </div>
</template>
