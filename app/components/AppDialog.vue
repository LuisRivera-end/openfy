<script setup lang="ts">
const props = defineProps<{ open: boolean; title: string; subtitle?: string }>()
const emit = defineEmits<{ close: [] }>()
const element = ref<HTMLDialogElement>()
const titleId = useId()
function sync() {
  if (props.open && !element.value?.open) element.value?.showModal()
  if (!props.open && element.value?.open) element.value?.close()
}
/** The dialog element is also the target for taps on its own padding; only a tap outside its box is the backdrop. */
function backdrop(event: MouseEvent) {
  if (event.target !== element.value) return
  const box = element.value.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) emit('close')
}
/** On phones the dialog is a bottom sheet; dragging its grabber or header down dismisses it. */
const drag = useSheetDrag(element, () => emit('close'))
onMounted(sync)
watch(() => props.open, sync)
</script>

<template>
  <dialog ref="element" class="app-dialog glass" :aria-labelledby="titleId" @close="emit('close')" @click="backdrop">
    <div class="sheet-handle" v-bind="drag" aria-hidden="true"><span /></div>
    <header v-bind="drag"><slot name="lead" /><div class="app-dialog-heading"><h2 :id="titleId">{{ title }}</h2><p v-if="subtitle" class="app-dialog-subtitle">{{ subtitle }}</p></div><button class="icon-button" aria-label="Cerrar diálogo" @click="emit('close')"><OIcon name="close" /></button></header>
    <slot />
  </dialog>
</template>
