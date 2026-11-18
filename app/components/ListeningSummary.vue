<script setup lang="ts">
import type { ListeningStats } from '../../shared/types/telemetry'
defineProps<{ summary: ListeningStats | null }>()
const telemetry = useTelemetryStore()
</script>
<template>
  <div class="listening-summary">
    <div class="listening-numbers"><div><strong>{{ Math.floor((summary?.listenedMs || 0) / 60000).toLocaleString('es-MX') }}</strong><span>minutos escuchados</span></div><div><strong>{{ (summary?.plays || 0).toLocaleString('es-MX') }}</strong><span>reproducciones</span></div></div>
    <p v-if="telemetry.pending" class="muted small" role="status">Hay escucha pendiente de sincronizar con tu PC.</p>
    <p v-if="telemetry.error" class="muted small" role="status">{{ telemetry.error }}</p>
  </div>
</template>
