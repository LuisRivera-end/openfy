<script setup lang="ts">
import { RELEASE_NOTE_LABELS } from '../../shared/utils/release-notes'
const notes = useReleaseNotesStore()
const format = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
function date(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? value : format.format(parsed)
}
</script>

<template>
  <AppDialog :open="notes.open" title="Novedades" class="release-notes-dialog" @close="notes.close">
    <p v-if="notes.since" class="muted">Esto es lo nuevo desde la {{ notes.since }}.</p>
    <div class="release-notes-body">
      <section v-for="release in notes.shown" :key="release.version" class="release-notes-section">
        <h3>Versión {{ release.version }} <span>· {{ date(release.date) }}</span></h3>
        <p v-if="release.summary">{{ release.summary }}</p>
        <ul>
          <li v-for="(item, index) in release.items" :key="index"><span class="release-tag" :class="item.type">{{ RELEASE_NOTE_LABELS[item.type] }}</span><span>{{ item.text }}</span></li>
        </ul>
      </section>
    </div>
    <button class="button primary release-notes-done" @click="notes.close">Entendido</button>
  </AppDialog>
</template>
