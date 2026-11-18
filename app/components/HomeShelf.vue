<script setup lang="ts">
const props = defineProps<{ title: string; featured?: boolean }>()
const rail = ref<HTMLElement>()
const previous = ref(false), next = ref(false)
let observer: ResizeObserver | undefined
function measure() {
  const el = rail.value
  if (el) { previous.value = el.scrollLeft > 2; next.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 2 }
}
function move(direction: number) {
  const el = rail.value
  el?.scrollBy({ left: direction * Math.max(200, el.clientWidth * .85), behavior: 'instant' })
}
function navigate(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const cards = [...rail.value!.querySelectorAll<HTMLElement>('[data-home-card]')]
  const current = cards.indexOf(document.activeElement as HTMLElement)
  if (current < 0) return
  event.preventDefault()
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : Math.max(0, Math.min(cards.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)))
  cards[index]?.focus({ preventScroll: true })
  cards[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
}
onMounted(() => { observer = new ResizeObserver(measure); observer.observe(rail.value!); measure() })
onUpdated(measure)
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section class="home-shelf" :class="{ 'home-shelf-featured': featured }" :aria-label="title">
    <header><h2>{{ title }}</h2><div class="shelf-tools"><slot name="action" /><button :disabled="!previous" :aria-label="`Anterior en ${props.title}`" @click="move(-1)"><OIcon name="back" :size="20" /></button><button :disabled="!next" :aria-label="`Siguiente en ${props.title}`" @click="move(1)"><OIcon class="shelf-next" name="back" :size="20" /></button></div></header>
    <div ref="rail" class="home-rail" @scroll.passive="measure" @keydown="navigate"><slot /></div>
  </section>
</template>

<style scoped>
.home-shelf { min-width: 0; margin-bottom: 32px; }
header { display: flex; align-items: center; justify-content: space-between; min-height: 42px; margin-bottom: 10px; gap: 12px; }
h2 { font-size: 22px; line-height: 1.25; letter-spacing: -.5px; }
.shelf-tools { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
.shelf-tools > button { display: grid; place-items: center; width: 34px; height: 36px; border-radius: 6px; color: #c5c5ca; }
@media (hover: hover) { .shelf-tools > button:hover:not(:disabled) { background: #ffffff0b; } }
.shelf-next { transform: rotate(180deg); }
.home-rail { display: flex; align-items: flex-start; gap: 20px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scrollbar-width: none; padding: 5px 4px 8px; margin: -5px -4px -8px; }
.home-rail::-webkit-scrollbar { display: none; }
.home-rail :deep(> *) { flex: 0 0 180px; min-width: 0; scroll-snap-align: start; }
.home-shelf-featured .home-rail :deep(> *) { flex-basis: 280px; }
@media (max-width: 700px) { h2 { font-size: 20px; } .home-rail { gap: 16px; } .home-rail :deep(> *) { flex-basis: 156px; } .home-shelf-featured .home-rail :deep(> *) { flex-basis: 260px; } .home-shelf { margin-bottom: 26px; } }
/* Phones: rows run to the screen edges and snap to the page gutter; swiping replaces the arrows on touch screens. */
@media (max-width: 760px), (pointer: coarse) and (max-height: 500px) { .home-rail { margin-inline: calc(-1 * var(--gutter, 20px)); padding-inline: var(--gutter, 20px); scroll-padding-inline: var(--gutter, 20px); } }
@media (hover: none) { .shelf-tools > button { display: none; } }
</style>
