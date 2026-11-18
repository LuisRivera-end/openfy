/**
 * Marks each navigation as forward, back or a tab switch (`<html data-nav>`), so the phone page transitions can
 * slide like an iOS navigation stack and cross-fade between tabs. Vue Router stores an increasing `position` in
 * history.state; on Back the popped entry's state is already current when the navigation starts.
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()
  const tabs = new Set(['/', '/search', '/library', '/downloads'])
  const position = () => { const value = window.history.state?.position; return typeof value === 'number' ? value : null }
  let last = position() ?? 0
  router.beforeEach((to, from) => {
    const current = position()
    document.documentElement.dataset.nav = tabs.has(to.path) && tabs.has(from.path) ? 'tab' : current !== null && current < last ? 'back' : 'forward'
  })
  router.afterEach(() => { last = position() ?? last })
})
