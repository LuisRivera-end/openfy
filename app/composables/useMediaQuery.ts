/** The phone shell: narrow screens, and touch screens held in landscape. Mirrors the CSS query in main.css. */
export const PHONE_QUERY = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)'

/** Reactive `matchMedia`; false until mounted on the client. */
export function useMediaQuery(query: string) {
  const matches = ref(false)
  if (import.meta.client) {
    const list = window.matchMedia(query)
    const update = () => { matches.value = list.matches }
    update()
    list.addEventListener('change', update)
    if (getCurrentInstance()) onBeforeUnmount(() => list.removeEventListener('change', update))
  }
  return matches
}

export const usePhone = () => useMediaQuery(PHONE_QUERY)

/** Reduced motion from the system or from Openfy's own "Movimiento ambiental" switch. */
export function prefersReducedMotion() {
  return import.meta.client && (matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion'))
}
