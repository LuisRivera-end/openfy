<script setup lang="ts">
import { House, Search, Library, Heart, Download, Settings, Plus,
  Shuffle, Repeat, Repeat1, Volume2, ListMusic, Maximize2, Minimize2, ChevronDown, ChevronLeft, X, Check,
  MoreHorizontal, Disc3, Music2, Wifi, WifiOff, LoaderCircle, RefreshCw, Trash2, ArrowUp, ArrowDown,
  Headphones, FolderPlus, Upload, ArrowRight, MicVocal, CircleArrowDown, Pencil, ChevronRight, ArrowUpDown } from '@lucide/vue'
// Transport glyphs are solid and shared with the native app (scripts/create-native-icons.mjs).
import transport from '../../shared/transport-icons.json'
const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const solid: Record<string, string[]> = transport
const icons: Record<string, typeof House> = {
  home: House, search: Search, library: Library, heart: Heart, download: Download, settings: Settings,
  plus: Plus, shuffle: Shuffle,
  repeat: Repeat, repeatOne: Repeat1, volume: Volume2, queue: ListMusic, expand: Maximize2, minimize: Minimize2,
  down: ChevronDown, back: ChevronLeft, close: X, check: Check, more: MoreHorizontal, disc: Disc3,
  music: Music2, online: Wifi, offline: WifiOff, loading: LoaderCircle, refresh: RefreshCw,
  trash: Trash2, up: ArrowUp, arrowDown: ArrowDown, headphones: Headphones, folder: FolderPlus,
  upload: Upload, arrow: ArrowRight,
  lyrics: MicVocal, downloaded: CircleArrowDown, edit: Pencil, forward: ChevronRight, sort: ArrowUpDown,
}
</script>

<template>
  <svg v-if="solid[props.name]" class="lucide" :data-icon="props.name" xmlns="http://www.w3.org/2000/svg" :width="size" :height="size" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path v-for="d in solid[props.name]" :key="d" :d="d" /></svg>
  <component :is="icons[props.name] || Music2" v-else :data-icon="props.name" :size="size" :stroke-width="1.8" aria-hidden="true" />
</template>
