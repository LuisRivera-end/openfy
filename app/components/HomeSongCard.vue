<script setup lang="ts">
import type { LibraryItem } from '../../shared/types/music'
import type { ListeningContext } from '../../shared/types/telemetry'
const props = defineProps<{ item: LibraryItem; featured?: boolean; context?: ListeningContext }>()
defineEmits<{ play: [] }>()
const player = usePlayerStore()
const menu = ref(false)
const press = useLongPress()
</script>

<template>
  <article class="home-song" :class="{ 'home-song-featured': featured, 'home-song-current': player.current?.id === item.id }" :style="featured ? { '--card-tint': item.palette?.[0] || '#28483e' } : undefined" v-bind="press(() => menu = true)">
    <button data-home-card class="home-song-play" :aria-label="`Reproducir ${item.title}`" @click="$emit('play')">
      <AlbumCover :src="item.artwork" :title="item.title" :palette="item.palette" :size="featured ? 1024 : 256" />
      <span class="home-song-copy"><strong :title="item.title">{{ item.title }}</strong><span :title="item.artist">{{ item.artist }}</span></span>
      <span class="home-song-play-icon"><OIcon name="play" :size="18" /></span>
    </button>
    <button class="home-song-menu" :aria-label="`Opciones de ${item.title}`" @click="menu = true"><OIcon name="more" :size="20" /></button>
  </article>
  <!-- Outside the card so presses inside the sheet never reach the card's long-press handlers. -->
  <SongActionsSheet :item="menu ? item : null" :context="context" @close="menu = false" />
</template>

<style scoped>
.home-song { position: relative; container-type: inline-size; }
.home-song-play { display: block; width: 100%; text-align: left; position: relative; border-radius: 8px; padding: 0; }
.home-song-play :deep(.album-cover) { width: 100%; aspect-ratio: 1; border-radius: 8px; }
.home-song-copy { display: flex; flex-direction: column; gap: 3px; padding: 10px 30px 0 0; }
.home-song-copy strong, .home-song-copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 1.4; }
.home-song-copy strong { font-weight: 600; }
.home-song-copy > span { color: #a1a1aa; font-size: 12px; }
.home-song-menu { position: absolute; right: -6px; bottom: 10px; width: 32px; height: 32px; display: grid; place-items: center; color: #a1a1aa; border-radius: 50%; }
@media (hover: hover) { .home-song-menu:hover { background: #ffffff13; color: white; } }
.home-song-play-icon { position: absolute; right: 10px; top: calc(100cqi - 42px); display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: #07160b; background: #1ed760; opacity: 0; }
.home-song:focus-within .home-song-play-icon, .home-song-current .home-song-play-icon { opacity: 1; }
@media (hover: hover) { .home-song:hover .home-song-play-icon { opacity: 1; } }
.home-song-featured .home-song-play { aspect-ratio: 4 / 5; overflow: hidden; border: 1px solid #ffffff14; border-radius: 10px;
  /* The full square cover sits on top; the lower band continues in the cover's own colour instead of cropping it. */
  --card-surface: color-mix(in srgb, var(--card-tint) 32%, #09090b); background: var(--card-surface); }
.home-song-featured .home-song-play :deep(.album-cover) { position: absolute; inset: 0 0 auto; width: 100%; aspect-ratio: 1; border-radius: 0; }
.home-song-featured .home-song-copy { position: absolute; inset: auto 0 0; min-height: 54%; justify-content: flex-end; padding: 0 50px 20px 18px;
  background: linear-gradient(color-mix(in srgb, var(--card-surface) 0%, transparent), color-mix(in srgb, var(--card-surface) 84%, transparent) 45%, var(--card-surface) 72%); }
.home-song-featured .home-song-copy strong { font-size: 19px; line-height: 1.32; padding-bottom: .08em; white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.home-song-featured .home-song-copy > span { color: #e0e0e5; font-size: 13px; }
.home-song-featured .home-song-menu { right: 10px; bottom: 16px; color: white; background: #0005; }
.home-song-featured .home-song-play-icon { top: 14px; right: 14px; width: 40px; height: 40px; }
@media (max-width: 700px) { .home-song-play-icon { opacity: 1; } }
/* Phones: a full-size target for the options button. */
@media (max-width: 760px), (pointer: coarse) and (max-height: 500px) { .home-song-menu { width: 44px; height: 44px; right: -10px; bottom: 2px; } .home-song-copy { padding-right: 38px; } .home-song-featured .home-song-menu { right: 8px; bottom: 10px; } }
</style>
