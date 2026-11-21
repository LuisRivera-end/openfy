/** Colours the window frame (sidebar, top bar, player, tab bar) takes while a coloured page is on screen. */
export interface PageChromeColors {
  background: string
  surface: string
  muted: string
  edge: string
}

interface PageChromeState { path: string; colors: PageChromeColors }

export function usePageChromeState() {
  return useState<PageChromeState | null>('page-chrome', () => null)
}

/**
 * A page publishes its colours for the route it is showing; returning nothing or leaving clears them.
 * The catch-all page keeps one instance across routes, so the path is followed rather than captured.
 */
export function useProvidePageChrome(colors: () => PageChromeColors | null | undefined) {
  const route = useRoute(), state = usePageChromeState()
  let currentPath: string | undefined
  function clear() { if (state.value?.path === currentPath) state.value = null }
  watch([() => route.path, colors], ([path, value]) => {
    if (!import.meta.client) return
    if (!value) { clear(); return }
    currentPath = path
    state.value = { path, colors: { ...value } }
  }, { immediate: true, deep: true, flush: 'post' })
  onBeforeUnmount(clear)
}
