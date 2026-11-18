import type { LibraryFilters } from '../../shared/types/telemetry'
import { collectionLibraryFilters, defaultLibraryFilters } from '../../shared/utils/library-filters'

export function useLibraryFilters(key: MaybeRefOrGetter<string>) {
  const filters = ref<LibraryFilters>(defaultLibraryFilters())
  let loading = false
  const load = () => {
    loading = true
    try { filters.value = { ...defaultLibraryFilters(), ...JSON.parse(localStorage.getItem(`openfy-filters:${toValue(key)}`) || '{}') } } catch { filters.value = defaultLibraryFilters() }
    if (toValue(key) !== 'most-played') {
      filters.value = collectionLibraryFilters(filters.value)
      try { localStorage.setItem(`openfy-filters:${toValue(key)}`, JSON.stringify(filters.value)) } catch { /* Storage can be full. */ }
    }
    loading = false
  }
  onMounted(load)
  watch(() => toValue(key), load)
  watch(filters, value => { if (!loading) { try { localStorage.setItem(`openfy-filters:${toValue(key)}`, JSON.stringify(value)) } catch { /* Storage can be full. */ } } }, { deep: true, flush: 'sync' })
  return filters
}
