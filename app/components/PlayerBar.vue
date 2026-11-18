<script setup lang="ts">
import { formatTime } from '../../shared/utils/media'
const player = usePlayerStore()
const library = useLibraryStore()
const lyrics = useLyricsStore()
const entry = computed(() => player.queue[player.index])
// The expanded player always shows lyrics; the bar shows them only in the side panel.
const lyricsVisible = computed(() => player.expanded || lyrics.panelOpen)
const lyricsIdentity = computed(() => entry.value ? JSON.stringify([player.current?.id, lyrics.signature(entry.value, player.duration)]) : '')
watch([lyricsVisible, lyricsIdentity, () => library.connected], () => {
  if (lyricsVisible.value) void lyrics.show(entry.value, player.duration)
}, { immediate: true })
watch(() => lyrics.panelOpen, (open) => { if (open) player.queueOpen = false })
watch(() => player.queueOpen, (open) => { if (open) lyrics.panelOpen = false })
function retryLyrics() { void lyrics.show(entry.value, player.duration, true) }
/** Phone mini player: a thin progress line, since the seek row is hidden there. */
/** Phones: Back or the edge swipe closes the expanded player; swiping the mini player up opens it. */
useOverlayHistory('player', () => player.expanded, () => { player.expanded = false })
const swipe = useSwipeUp(() => { if (player.current) player.expanded = true })
const progress = computed(() => Number.isFinite(player.duration) && player.duration > 0 ? Math.min(1, Math.max(0, player.position / player.duration)) : 0)
</script>

<template>
  <footer class="player-bar glass" aria-label="Reproductor" v-bind="swipe">
    <div class="now-playing">
      <!-- The button spans the whole block through a subgrid; the artist sits on top in row 2 so it can link elsewhere. -->
      <button class="now-playing-open" :disabled="!player.current" aria-label="Abrir reproductor ampliado" @click="player.expanded = true">
        <AlbumCover :src="player.current?.artwork" :title="player.current?.album" :palette="player.current?.palette" />
        <strong>{{ player.current?.title || 'Tu música, contigo' }}</strong>
      </button>
      <TrackArtistLink v-if="player.current" class="now-playing-artist" :entry="entry" :artist="player.current.artist" />
      <span v-else class="now-playing-artist">Elige una canción para empezar</span>
    </div>
    <div class="player-center">
      <div class="transport">
        <button class="icon-button desktop-control toggle" :class="{ active: player.shuffle }" aria-label="Reproducción aleatoria" :aria-pressed="player.shuffle" :disabled="!player.current" @click="player.toggleShuffle"><OIcon name="shuffle" :size="18" /></button>
        <button class="icon-button desktop-control" aria-label="Canción anterior" :disabled="!player.current" @click="player.advance(-1)"><OIcon name="previous" /></button>
        <button class="play-button" :aria-label="player.playing ? 'Pausar' : 'Reproducir'" :disabled="!player.current" @click="player.toggle"><OIcon :name="player.buffering ? 'loading' : player.playing ? 'pause' : 'play'" :class="{ spin: player.buffering }" :size="21" /></button>
        <button class="icon-button" aria-label="Siguiente canción" :disabled="!player.current" @click="player.advance(1)"><OIcon name="next" /></button>
        <button class="icon-button desktop-control toggle" :class="{ active: player.repeat !== 'off' }" :aria-label="`Repetición: ${player.repeat === 'off' ? 'desactivada' : player.repeat === 'all' ? 'toda la cola' : 'una canción'}`" :disabled="!player.current" @click="player.cycleRepeat"><OIcon :name="player.repeat === 'one' ? 'repeatOne' : 'repeat'" :size="18" /></button>
      </div>
      <div class="seek-row"><span>{{ formatTime(player.position) }}</span><input aria-label="Posición de reproducción" :aria-valuetext="formatTime(player.position)" type="range" min="0" :max="Number.isFinite(player.duration) ? player.duration : 0" :value="player.position" step="0.1" :disabled="!player.current" @input="player.seek(Number(($event.target as HTMLInputElement).value))"><span>{{ formatTime(player.duration) }}</span></div>
    </div>
    <div class="player-tools">
      <button class="icon-button" :class="{ active: lyrics.panelOpen }" aria-label="Mostrar letras" :aria-pressed="lyrics.panelOpen" :disabled="!player.current" @click="lyrics.panelOpen = !lyrics.panelOpen"><OIcon name="lyrics" /></button>
      <button class="icon-button" :class="{ active: player.queueOpen }" aria-label="Mostrar cola" :aria-pressed="player.queueOpen" @click="player.queueOpen = !player.queueOpen"><OIcon name="queue" /></button>
      <OIcon name="volume" :size="18" /><input aria-label="Volumen" class="volume-slider" type="range" min="0" max="1" step="0.01" :value="player.volume" :aria-valuetext="`${Math.round(player.volume * 100)} %`" @input="player.setVolume(Number(($event.target as HTMLInputElement).value))">
      <button class="icon-button" aria-label="Ampliar reproductor" :disabled="!player.current" @click="player.expanded = true"><OIcon name="expand" :size="18" /></button>
    </div>
    <span class="mini-progress" :style="{ '--progress': progress }" aria-hidden="true" />
  </footer>

  <aside v-if="lyrics.panelOpen && !player.expanded" class="lyrics-panel glass" aria-label="Letras">
    <header><div><h2>Letras</h2><p>{{ player.current?.title }}</p></div><button class="icon-button" aria-label="Cerrar letras" @click="lyrics.panelOpen = false"><OIcon name="close" /></button></header>
    <LyricsPanel @retry="retryLyrics" />
  </aside>

  <PlaybackQueue v-if="player.queueOpen" />

  <Teleport to="body">
    <ImmersivePlayer v-if="player.expanded && player.current" @retry="retryLyrics" />
  </Teleport>
</template>
