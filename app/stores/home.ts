import { defineStore } from 'pinia'
import type { RecentListening, Recommendations } from '../../shared/types/telemetry'
import { DISCOVERY_VERSION } from '../../shared/utils/discovery'
import { readLocal, writeLocal } from '../lib/local'

/** The opening screen and Home share the same cache and in-flight requests. */
export const useHomeStore = defineStore('home', () => {
  const library = useLibraryStore()
  const recommendations = shallowRef<Recommendations | null>(null)
  const recent = shallowRef<RecentListening>({ items: [] })
  const busy = ref(false), error = ref(''), ready = ref(false)
  let initial: Promise<void> | undefined, recentRequest: Promise<void> | undefined, recommendationRequest: Promise<void> | undefined
  function loadRecent(): Promise<void> {
    if (recentRequest) return recentRequest
    if (!library.connected) return Promise.resolve()
    return recentRequest = (async () => {
      try {
        const result = await $fetch<RecentListening>('/api/telemetry/recent', { timeout: 10000, retry: 0 })
        recent.value = result; await writeLocal('listening-recent-v2', result).catch(() => {})
      } catch { /* Preserve synchronized history. */ }
      finally { recentRequest = undefined }
    })()
  }
  function loadRecommendations(refresh = false): Promise<void> {
    if (recommendationRequest) return recommendationRequest
    if (!library.connected) return Promise.resolve()
    busy.value = true; error.value = ''
    return recommendationRequest = (async () => {
      try {
        const result = await $fetch<Recommendations>('/api/music/recommendations', { query: { refresh }, timeout: 60000, retry: 0 })
        recommendations.value = result; await writeLocal('listening-discovery-v2', result).catch(() => {})
      } catch { error.value = 'No se pudieron actualizar las sugerencias. Vuelve a intentarlo.' }
      finally { busy.value = false; recommendationRequest = undefined }
    })()
  }
  function initialize(): Promise<void> {
    return initial ||= (async () => {
      const [cachedRecommendations, cachedRecent] = await Promise.all([readLocal<Recommendations>('listening-discovery-v2').catch(() => null), readLocal<RecentListening>('listening-recent-v2').catch(() => null)])
      recommendations.value = cachedRecommendations?.algorithmVersion === DISCOVERY_VERSION ? cachedRecommendations : null
      recent.value = cachedRecent || { items: [] }; ready.value = true
      const history = loadRecent(), discovery = loadRecommendations()
      await Promise.all([cachedRecent ? undefined : history, recommendations.value ? undefined : discovery])
    })()
  }
  return { recommendations, recent, busy, error, ready, initialize, loadRecent, loadRecommendations }
})
