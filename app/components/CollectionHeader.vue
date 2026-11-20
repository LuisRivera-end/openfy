<script setup lang="ts">
import type { ArtistTheme, LibraryItem } from '../../shared/types/music'
import type { ListeningContext } from '../../shared/types/telemetry'
import { formatCollectionDuration } from '../../shared/utils/media'
import { songCount } from '../../shared/utils/text'

defineProps<{
  title: string
  kind: string
  items: LibraryItem[]
  results: LibraryItem[]
  context?: ListeningContext
  artwork?: string | null
  favorite?: boolean
  artist?: boolean
  artistTheme?: ArtistTheme
  subtitle?: string
}>()

</script>

<template>
  <header
    class="collection-heading"
    :class="{ 'is-artist': artist, 'has-long-title': title.length > 48 }"
    :style="artistTheme ? { background: `linear-gradient(180deg, ${artistTheme.base}, ${artistTheme.deep})` } : undefined"
  >
    <AlbumCover :src="artwork" :title="title" :favorite="favorite" :palette="items[0]?.palette" />
    <div class="collection-heading-copy">
      <p class="collection-kind">{{ kind }}</p>
      <h1>{{ title }}</h1>
      <p class="muted collection-metadata">
        <span v-if="subtitle">{{ subtitle }}</span>
        <span>{{ songCount(items.length) }}</span>
        <span class="collection-duration">{{ formatCollectionDuration(items.reduce((sum, item) => sum + item.duration, 0)) }}</span>
      </p>
    </div>
    <div class="collection-heading-actions">
      <CollectionPlaybackActions :items="results" :context="context" />
      <div v-if="$slots.default" class="collection-secondary-actions"><slot /></div>
    </div>
  </header>
</template>

<style scoped>
.collection-heading.is-artist {
  border-radius: 16px;
  padding: 24px;
}
@media (max-width: 760px) {
  .collection-heading.is-artist {
    border-radius: 0;
    margin-inline: calc(-1 * var(--gutter, 16px));
    padding: 20px var(--gutter, 16px);
  }
}
</style>
