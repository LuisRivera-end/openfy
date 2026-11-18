<script setup lang="ts">
import { formatBytes } from '../../shared/utils/media'
import { describePlayback } from '../../shared/utils/playback'
import type { DownloadRecord } from '../../shared/types/music'
import { countLabel } from '../../shared/utils/text'
const downloads = useDownloadsStore()
const library = useLibraryStore()
const player = usePlayerStore()
const records = computed(() => Object.values(downloads.records).sort((a, b) => b.updatedAt - a.updatedAt))
function entry(record: DownloadRecord) { return record.entry || library.collectionMap.get(record.trackId)?.entry }
function description(record: DownloadRecord) { return library.collectionMap.get(record.trackId) || describePlayback(entry(record), library.trackMap) }
function state(record: DownloadRecord) {
  return record.state === 'ready' ? 'Disponible sin conexión' : record.state === 'preparing' ? downloads.preparationLabel(record)
    : record.state === 'queued' ? 'En espera' : record.state === 'downloading' ? `Descargando al dispositivo ${Math.round(record.bytes / Math.max(1, record.total) * 100)} %` : record.error
}
/** Removing a finished download asks first: the file only comes back with a connection. Cancelling a transfer does not. */
const removing = ref<DownloadRecord | null>(null)
function remove(record: DownloadRecord) { if (record.state === 'ready') removing.value = record; else void downloads.remove(record.trackId) }
function confirmRemove() { if (removing.value) void downloads.remove(removing.value.trackId); removing.value = null }
function play() { player.playEntries(records.value.filter(record => record.state === 'ready').flatMap(record => entry(record) || [])) }
</script>

<template>
  <div class="page-heading"><div><p class="greeting">Tu música sin conexión</p><h1>Siempre contigo</h1><p class="muted">Las descargas pertenecen a este dispositivo. Quitar una canción de una playlist conserva su archivo.</p></div><OIcon name="download" :size="44" /></div>
  <div class="storage-panel glass"><div><h3>{{ countLabel(downloads.readyIds.size, 'canción descargada', 'canciones descargadas') }}</h3><p>{{ formatBytes(downloads.usage) }} utilizados<span v-if="downloads.quota"> · {{ formatBytes(downloads.quota) }} de cuota estimada</span></p><p class="storage-persistence">{{ downloads.persistent ? 'El sistema protege estas descargas aunque falte espacio.' : 'Si falta espacio, el sistema puede borrar estas descargas. Tus originales siguen en el PC.' }}</p></div><progress :value="downloads.usage" :max="downloads.quota || 1" aria-label="Espacio utilizado" /></div>
  <button v-if="downloads.readyIds.size" class="button primary" @click="play"><OIcon name="play" :size="18" />Escuchar descargas</button>
  <section v-if="Object.values(downloads.collections).some(target => target.enabled)" class="settings-panel offline-collections">
    <h2>Se mantienen descargadas</h2>
    <div v-for="target in Object.values(downloads.collections).filter(target => target.enabled)" :key="target.key" class="setting-row">
      <div><strong>{{ target.title }}</strong><p>{{ downloads.progress(target.key).completed }} de {{ countLabel(downloads.progress(target.key).total, 'canción', 'canciones') }} · Las nuevas canciones se descargarán al abrir Openfy con conexión.</p></div>
      <button class="button subtle" @click="downloads.toggleCollection(target.kind, target.id)">Dejar de actualizar</button>
    </div>
  </section>
  <div v-if="!records.length" class="empty-state"><OIcon name="download" :size="48" /><h2>Tu música también va sin Internet.</h2><p>Descarga canciones o mantén descargado un álbum o playlist. Espera a que termine antes de salir.</p><NuxtLink class="button primary" to="/library">Explorar biblioteca</NuxtLink></div>
  <div v-for="record in records" :key="record.trackId" class="download-row">
    <AlbumCover :src="record.artwork || description(record)?.artwork" />
    <div class="download-copy"><strong>{{ description(record)?.title || 'Canción guardada' }}</strong><span role="status">{{ state(record) }}</span><progress v-if="record.state === 'downloading'" :value="record.bytes" :max="record.total" aria-label="Progreso de descarga" /></div>
    <span class="download-size">{{ formatBytes(record.total) }}</span>
    <button v-if="record.state === 'error'" class="icon-button" :disabled="!library.connected" :aria-label="`Reintentar descarga de ${description(record)?.title}`" @click="downloads.retry(record.trackId)"><OIcon name="refresh" /></button>
    <button class="icon-button" :aria-label="['preparing', 'queued', 'downloading'].includes(record.state) ? 'Cancelar descarga' : 'Eliminar descarga de este dispositivo'" @click="remove(record)"><OIcon :name="['preparing', 'queued', 'downloading'].includes(record.state) ? 'close' : 'trash'" :size="19" /></button>
  </div>
  <AppDialog :open="!!removing" title="Eliminar descarga" @close="removing = null"><p class="muted">«{{ removing && (description(removing)?.title || 'Esta canción') }}» dejará de estar disponible sin conexión en este dispositivo. Podrás volver a descargarla con conexión.</p><div class="dialog-actions"><button class="button subtle" @click="removing = null">Cancelar</button><button class="button danger" @click="confirmRemove">Eliminar descarga</button></div></AppDialog>
</template>

<style scoped>
.offline-collections .setting-row { flex-wrap: wrap; }
.offline-collections .setting-row > div { flex: 1 1 220px; min-width: 0; }
</style>
