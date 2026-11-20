<script setup lang="ts">
/**
 * Back navigation for detail pages. Goes back through Openfy's own history (so the iOS edge swipe and this button
 * agree) and falls back to the tab root on a cold start. On phones it is a sticky bar whose compact title fades in
 * once the page's own title has scrolled away (scroll-driven animation where supported).
 */
const props = withDefaults(defineProps<{ title?: string; fallback: string; phoneOnly?: boolean; labels?: Record<string, string>; tint?: string }>(), { title: '', phoneOnly: false, labels: () => ({}) })
const router = useRouter()
const names: Record<string, string> = { '/': 'Inicio', '/search': 'Buscar', '/library': 'Tu biblioteca', '/downloads': 'Descargas', '/favorites': 'Tus favoritas', '/most-played': 'Más reproducidas' }
const previous = ref<string | null>(null)
const route = useRoute()
function read() { const back = window.history.state?.back; previous.value = typeof back === 'string' ? back : null }
onMounted(read)
// The same page component can be reused for the next album or artist; history.state is current once the route is.
watch(() => route.fullPath, () => { if (import.meta.client) read() })
const label = computed(() => {
  const known = { ...names, ...props.labels }
  if (!previous.value) return known[props.fallback] || 'Atrás'
  return known[previous.value.split(/[?#]/)[0]!] || 'Atrás'
})
function back() {
  if (previous.value) router.back()
  else void navigateTo(props.fallback)
}
</script>

<template>
  <div class="detail-bar" :class="{ 'detail-bar-phone': phoneOnly }" :style="tint ? { background: tint } : undefined">
    <button class="detail-back" :aria-label="`Volver a ${label}`" @click="back"><OIcon name="back" :size="24" /><span>{{ label }}</span></button>
    <span v-if="title" class="detail-bar-title" aria-hidden="true">{{ title }}</span>
  </div>
</template>
