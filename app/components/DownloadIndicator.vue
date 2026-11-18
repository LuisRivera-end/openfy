<script setup lang="ts">
defineProps<{ trackId: string }>()
const downloads = useDownloadsStore()
</script>

<template>
  <span v-if="downloads.readyIds.has(trackId)" class="download-indicator" role="img" aria-label="Descargada en este dispositivo" title="Descargada · Disponible sin conexión en este dispositivo"><OIcon name="downloaded" :size="16" /></span>
</template>
