/**
 * Gives a full-screen overlay (the expanded player) its own history entry on phones, so the iOS edge swipe or the
 * browser Back closes it instead of leaving the page. Uses a same-path query (`?overlay=<key>`), which Nuxt's
 * router neither remounts nor scrolls for. Closing with a button goes back to the entry underneath.
 * Reads `router.currentRoute`: outside <NuxtPage>, `useRoute()` only updates once the next page has rendered.
 */
export function useOverlayHistory(key: string, isOpen: () => boolean, close: () => void) {
  const router = useRouter(), phone = usePhone()
  const overlay = () => router.currentRoute.value.query.overlay
  let pushed = false
  watch(isOpen, open => {
    if (open && phone.value && overlay() !== key) {
      pushed = true
      void router.push({ query: { ...router.currentRoute.value.query, overlay: key } })
    } else if (!open && pushed) {
      pushed = false
      // A navigation from inside the overlay replaces its entry instead (SongActionsSheet), so nothing to undo.
      if (overlay() === key) router.back()
    }
  })
  watch(overlay, (value, previous) => {
    if (previous === key && value !== key) { pushed = false; if (isOpen()) close() }
  })
  // A reload or a shared link must not reopen an empty overlay entry.
  onMounted(() => {
    if (overlay() === key && !isOpen()) {
      const { overlay: _, ...query } = router.currentRoute.value.query
      void router.replace({ query })
    }
  })
}
