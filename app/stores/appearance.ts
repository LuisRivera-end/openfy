import { defineStore } from 'pinia'
/** Glass surfaces: `default` follows the system's reduced-transparency preference; `on` and `off` override it. */
export type TransparencyMode = 'default' | 'on' | 'off'
const transparencyModes: readonly TransparencyMode[] = ['default', 'on', 'off']
export const useAppearanceStore = defineStore('appearance', () => {
  const effects = ref(true)
  /** Narrow expanded player: artwork first; the lyrics view is a remembered choice per device. */
  const immersiveLyrics = ref(false)
  /** Desktop Big Picture: replace the cover with the album's looping video when it has one. */
  const motionArt = ref(true)
  const transparency = ref<TransparencyMode>('default')
  if (import.meta.client) {
    try { const saved = localStorage.getItem('openfy-transparency') as TransparencyMode | null; if (saved && transparencyModes.includes(saved)) transparency.value = saved } catch {}
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
  // Windows without activation cannot turn transparency on, so the setting can force the glass regardless.
  const systemReduced = import.meta.client ? matchMedia('(prefers-reduced-transparency: reduce)') : undefined
  function applyTransparency() {
    if (!import.meta.client) return
    const off = transparency.value === 'off' || (transparency.value === 'default' && !!systemReduced?.matches)
    document.documentElement.classList.toggle('transparency-off', off)
  }
  systemReduced?.addEventListener('change', applyTransparency)
  watch(transparency, value => {
    applyTransparency()
    try { if (value === 'default') localStorage.removeItem('openfy-transparency'); else localStorage.setItem('openfy-transparency', value) } catch {}
  }, { immediate: true, flush: 'sync' })
  watch(immersiveLyrics, value => { try { localStorage.setItem('openfy-immersive-lyrics', value ? 'on' : 'off') } catch {} })
  watch(motionArt, value => { try { localStorage.setItem('openfy-motion-art', value ? 'on' : 'off') } catch {} })
  return { effects, immersiveLyrics, motionArt, transparency }
})
