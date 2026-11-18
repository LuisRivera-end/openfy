/** Register only the first route's data. Later navigation keeps its existing loading UI. */
export function useStartupContent(available: () => boolean) {
  const startup = useStartupStore()
  if (startup.phase !== 'loading') return
  let finish!: () => void
  void startup.track(new Promise<void>(resolve => { finish = resolve }))
  const stop = watch(available, value => { if (value) finish() }, { immediate: true })
  onScopeDispose(() => { stop(); finish() })
}
