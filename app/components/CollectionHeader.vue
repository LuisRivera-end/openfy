<script setup lang="ts">
import type { ArtistTheme, LibraryItem } from '../../shared/types/music'
import type { ListeningContext } from '../../shared/types/telemetry'
import { formatCollectionDuration } from '../../shared/utils/media'
import { songCount } from '../../shared/utils/text'

const props = defineProps<{
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
  album?: boolean
  year?: number | null
  artistName?: string
  description?: { text: string; source: 'apple' | 'youtube' } | null
  motionUrl?: string
}>()

defineEmits<{
  'motion-failed': []
}>()

const albumDuration = computed(() => {
  return props.items.length > 0 && props.items.every(item => item.duration > 0)
    ? props.items.reduce((sum, item) => sum + item.duration, 0)
    : null
})
</script>

<template>
  <header
    class="collection-heading"
    :class="{ 'is-artist': artist, 'is-album': album, 'has-long-title': title.length > 48 }"
    :style="artistTheme ? { background: `linear-gradient(180deg, ${artistTheme.base}, ${artistTheme.deep})` } : undefined"
  >
    <AlbumCover :src="artwork" :title="title" :favorite="favorite" :palette="items[0]?.palette">
      <MotionArt v-if="motionUrl" :src="motionUrl" @failed="$emit('motion-failed')" />
    </AlbumCover>
    <div class="collection-heading-copy">
      <p v-if="!album" class="collection-kind">{{ kind }}</p>
      <h1>{{ title }}</h1>
      <template v-if="album">
        <p v-if="artistName || subtitle" class="album-artist">
          <TrackArtistLink v-if="items[0]?.entry" :entry="items[0].entry" :artist="artistName || subtitle!" />
          <span v-else>{{ artistName || subtitle }}</span>
        </p>
        <p v-if="year" class="album-year">{{ year }}</p>
        <AlbumDescription v-if="description" :title="title" :description="description" />
      </template>
      <p v-else class="muted collection-metadata">
        <span v-if="subtitle">{{ subtitle }}</span>
        <span>{{ songCount(items.length) }}</span>
        <span class="collection-duration">{{ formatCollectionDuration(items.reduce((sum, item) => sum + item.duration, 0)) }}</span>
      </p>
    </div>
    <div class="collection-heading-actions">
      <CollectionPlaybackActions :items="results" :context="context" />
      <div v-if="$slots.default" class="collection-secondary-actions"><slot /></div>
    </div>
    <div v-if="album" class="album-summary muted">
      <span>{{ songCount(items.length) }}</span>
      <span v-if="albumDuration"> · {{ formatCollectionDuration(albumDuration) }}</span>
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
