<script setup lang="ts">
const search = useSearchStore()
const route = useRoute()
const phone = usePhone()
const field = ref<HTMLInputElement>()
let headerObserver: ResizeObserver | undefined
onMounted(() => {
  const header = field.value?.closest('header')
  if (!header) return
  headerObserver = new ResizeObserver(() => header.parentElement?.style.setProperty('--search-header-height', `${header.getBoundingClientRect().height}px`))
  headerObserver.observe(header)
})
onBeforeUnmount(() => headerObserver?.disconnect())
function edit(value: string) { search.edit(value); if (route.path !== '/search') void navigateTo('/search') }
function clear() { edit(''); field.value?.focus() }
function submit() { if (route.path !== '/search') void navigateTo('/search'); search.resume(true); if (phone.value) field.value?.blur() }
</script>

<template>
  <form class="global-search" role="search" @submit.prevent="submit">
    <label class="search-field"><OIcon name="search" :size="18" /><input id="global-search" ref="field" :value="search.query" type="text" maxlength="200" aria-label="Buscar en YouTube Music" placeholder="¿Qué quieres escuchar?" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" @input="edit(($event.target as HTMLInputElement).value)"><button v-if="search.query" type="button" class="icon-button" aria-label="Limpiar búsqueda" @click="clear"><OIcon name="close" :size="18" /></button></label>
  </form>
</template>
