export function useMusicCollection<T>(url: () => string, field: 'songs' | 'albums', query: Record<string, string> = {}) {
  const items = shallowRef<T[]>([])
  const cursor = ref<string | null>(null)
  const started = ref(false)
  const busy = ref(false)
  const error = ref('')
  const expired = ref(false)
  let controller: AbortController | undefined
  let generation = 0
  function clear() {
    generation++; controller?.abort()
    items.value = []; cursor.value = null; started.value = false; busy.value = false; error.value = ''; expired.value = false
  }
  async function load(reset = false) {
    if (busy.value || (started.value && !cursor.value && !reset)) return
    const request = generation
    controller = new AbortController()
    busy.value = true; error.value = ''
    try {
      const result = await $fetch<{ songs?: T[]; albums?: T[]; nextCursor: string | null }>(url(), {
        query: { ...query, ...(!reset && cursor.value ? { cursor: cursor.value } : {}) }, signal: controller.signal, timeout: 20000, retry: 0,
      })
      if (request !== generation) return
      items.value = reset || !started.value ? result[field] || [] : [...items.value, ...(result[field] || [])]
      cursor.value = result.nextCursor; started.value = true; expired.value = false
    } catch (reason) {
      if (request !== generation) return
      const failure = reason as { statusCode?: number; data?: { message?: string; statusCode?: number } }
      expired.value = failure.statusCode === 410 || failure.data?.statusCode === 410
      error.value = failure.data?.message || 'No se pudo cargar el catálogo. Vuelve a intentarlo.'
    } finally { if (request === generation) busy.value = false }
  }
  watch(url, clear)
  onBeforeUnmount(() => { generation++; controller?.abort() })
  return reactive({ items, cursor, started, busy, error, expired, load })
}
