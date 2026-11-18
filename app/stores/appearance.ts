import { defineStore } from 'pinia'
export const useAppearanceStore = defineStore('appearance', () => {
  const effects = ref(true)
  /** Narrow expanded player: artwork first; the lyrics view is a remembered choice per device. */
  const immersiveLyrics = ref(false)
  /** Desktop Big Picture: replace the cover with the album's looping video when it has one. */
  const motionArt = ref(true)
  if (import.meta.client) {
    try { motionArt.value = localStorage.getItem('openfy-motion-art') !== 'off' } catch {}
    try { localStorage.removeItem('openfy-new-design') } catch {}
    try { effects.value = localStorage.getItem('openfy-motion') !== 'off' } catch {}
    try { immersiveLyrics.value = localStorage.getItem('openfy-immersive-lyrics') === 'on' } catch {}
  }
  function apply() {
    if (!import.meta.client) return
    document.documentElement.classList.toggle('reduce-motion', !effects.value)
    try { localStorage.setItem('openfy-motion', effects.value ? 'on' : 'off') } catch {}
  }
  watch(effects, apply, { immediate: true, flush: 'sync' })
  watch(immersiveLyrics, value => { try { localStorage.setItem('openfy-immersive-lyrics', value ? 'on' : 'off') } catch {} })
  watch(motionArt, value => { try { localStorage.setItem('openfy-motion-art', value ? 'on' : 'off') } catch {} })
  return { effects, immersiveLyrics, motionArt }
})
