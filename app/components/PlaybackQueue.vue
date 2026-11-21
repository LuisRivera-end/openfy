<script setup lang="ts">
import { formatTime } from '../../shared/utils/media'
import { turnedPlayerKey } from '../composables/useMobileBigPicture'
/** `panel` docks beside the page (desktop); `sheet` is the body of the queue sheet over the expanded player. */
const props = withDefaults(defineProps<{ variant?: 'panel' | 'sheet' }>(), { variant: 'panel' })
const sheet = computed(() => props.variant === 'sheet')
const turned = inject(turnedPlayerKey, undefined)
const player = usePlayerStore()
const list = ref<HTMLElement>(), menu = ref<string>(), announcement = ref('')
const dragging = ref<string>(), before = ref<string>(), dropped = ref(false), landed = ref<string>()
let movedTimer: ReturnType<typeof setTimeout> | undefined
let originY = 0, pointerY = 0, moved = false, frame = 0
const pointerAlongList = (event: PointerEvent) => turned?.value ? -event.clientX : event.clientY
function move(id: string, direction: number) {
  const rows = player.upcoming, i = rows.findIndex(row => row.entry.queueId === id)
  if (i < 0 || i + direction < 0 || i + direction >= rows.length) return
  player.moveInQueue(id, rows[i + (direction > 0 ? 2 : -1)]?.entry.queueId)
  announcement.value = `Canción movida a la posición ${i + direction + 1}`
}
function tick() {
  if (!dragging.value || !list.value) return
  const rect = list.value.getBoundingClientRect()
  if (moved) {
    const top = turned?.value ? -rect.right : rect.top
    const bottom = turned?.value ? -rect.left : rect.bottom
    const delta = pointerY < top + 44 ? -10 : pointerY > bottom - 44 ? 10 : 0
    list.value.scrollTop += delta
    const rows = [...list.value.querySelectorAll<HTMLElement>('[data-queue-id]')].filter(row => row.dataset.queueId !== dragging.value)
    before.value = rows.find(row => {
      const bounds = row.getBoundingClientRect()
      return pointerY < (turned?.value ? -bounds.right : bounds.top) + row.offsetHeight / 2
    })?.dataset.queueId
  }
  frame = requestAnimationFrame(tick)
}
function start(event: PointerEvent, id: string) {
  if (event.button !== 0) return
  menu.value = undefined
  window.addEventListener('keydown', cancelWithEscape, true)
  dragging.value = id; originY = pointerY = pointerAlongList(event); moved = false; dropped.value = false
  const handle = event.currentTarget as HTMLElement
  handle.focus({ preventScroll: true })
  handle.setPointerCapture(event.pointerId)
  frame = requestAnimationFrame(tick)
}
function motion(event: PointerEvent) { if (dragging.value) { pointerY = pointerAlongList(event); moved ||= Math.abs(pointerY - originY) > 6 } }
function cancelWithEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  finish(true)
}
function finish(cancel = false) {
  if (!dragging.value) return
  window.removeEventListener('keydown', cancelWithEscape, true)
  // A cancelled drag still generates a click when the pointer is released.
  dropped.value = moved || cancel
  if (!cancel && dragging.value && moved) {
    player.moveInQueue(dragging.value, before.value); announcement.value = 'Orden de reproducción actualizado'
    // Briefly tint the row where it landed so the new position is obvious.
    landed.value = dragging.value; clearTimeout(movedTimer); movedTimer = setTimeout(() => { landed.value = undefined }, 1600)
  }
  dragging.value = before.value = undefined; cancelAnimationFrame(frame)
}
onBeforeUnmount(() => { clearTimeout(movedTimer); cancelAnimationFrame(frame); window.removeEventListener('keydown', cancelWithEscape, true) })
if (turned) watch(turned, () => finish(true))
</script>
<template>
  <component :is="sheet ? 'div' : 'aside'" :class="sheet ? 'queue-sheet-body' : 'queue-panel glass'" :aria-label="sheet ? undefined : 'Cola de reproducción'" @keydown.esc="dragging ? (finish(true), $event.stopPropagation()) : !sheet && (player.queueOpen = false)">
    <header v-if="!sheet"><h2>Cola de reproducción</h2><button class="icon-button" aria-label="Cerrar cola" @click="player.queueOpen = false"><OIcon name="close" /></button></header>
    <div v-if="sheet && player.current" class="queue-now"><AlbumCover :src="player.current.artwork" :title="player.current.album" :size="128" /><span class="track-copy"><small>Sonando ahora</small><strong>{{ player.current.title }}</strong><span>{{ player.current.artist }}</span></span></div>
    <p class="queue-count muted">{{ player.upcoming.length }} {{ player.upcoming.length === 1 ? 'canción pendiente' : 'canciones pendientes' }}</p>
    <p v-if="!player.upcoming.length" class="queue-empty muted">No hay más canciones en la cola. Añade música para seguir escuchando.</p>
    <div ref="list" class="queue-scroll" :class="{ 'queue-dragging': dragging }">
      <div v-for="(row, i) in player.upcoming" :key="row.entry.queueId" :data-queue-id="row.entry.queueId" class="queue-item" :class="{ 'queue-insertion': dragging && before === row.entry.queueId, 'queue-lifted': dragging === row.entry.queueId, 'queue-moved': landed === row.entry.queueId }">
        <button class="queue-grip icon-button" :aria-label="`Mover ${row.track?.title}`" aria-description="Usa Alt y las flechas para cambiar la posición, o abre las opciones." @pointerdown="start($event, row.entry.queueId!)" @pointermove="motion" @pointerup="finish()" @pointercancel="finish(true)" @keydown.alt.up.prevent="move(row.entry.queueId!, -1)" @keydown.alt.down.prevent="move(row.entry.queueId!, 1)" @click="!dropped && (menu = menu === row.entry.queueId ? undefined : row.entry.queueId)">⠿</button>
        <button class="queue-song" :aria-label="`Escuchar ${row.track?.title || 'canción'}`" @click="player.jump(row.index)"><AlbumCover :src="row.track?.artwork" :title="row.track?.album" :size="128" /><span class="track-copy"><strong>{{ row.track?.title }}</strong><span>{{ row.track?.artist }}</span></span></button>
        <span class="queue-duration">{{ formatTime(row.track?.duration || 0) }}</span>
        <button class="icon-button" :aria-label="`Opciones de ${row.track?.title}`" :aria-expanded="menu === row.entry.queueId" @click="menu = menu === row.entry.queueId ? undefined : row.entry.queueId"><OIcon name="more" :size="18" /></button>
        <div v-if="menu === row.entry.queueId" class="queue-options">
          <button :disabled="i === 0" @click="move(row.entry.queueId!, -1)">Mover arriba</button><button :disabled="i === player.upcoming.length - 1" @click="move(row.entry.queueId!, 1)">Mover abajo</button><button @click="player.removeFromQueue(row.index); menu = undefined">Quitar de la cola</button>
        </div>
      </div>
      <div v-if="dragging && !before" class="queue-end-marker" />
    </div>
    <span class="sr-only" role="status">{{ announcement }}</span>
  </component>
</template>
