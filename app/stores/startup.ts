import { defineStore } from 'pinia'
import { startupDeadline, STARTUP_ESSENTIAL_TIMEOUT, waitForStartupContent } from '../../shared/utils/startup'

export const useStartupStore = defineStore('startup', () => {
  const phase = ref<'loading' | 'revealing' | 'ready' | 'error'>('loading')
  const coreReady = ref(false), error = ref('')
  const blocked = computed(() => phase.value !== 'ready')
  const visible = computed(() => phase.value === 'loading' || phase.value === 'error')
  const stages = new Map<string, Promise<void>>()
  const content = new Set<Promise<unknown>>()
  let running: Promise<void> | undefined, lifetime: AbortController | undefined
  let generation = 0

  function stage(name: string, work: () => Promise<void>) {
    let task = stages.get(name)
    if (!task) {
      task = work().catch(failure => { stages.delete(name); throw failure })
      stages.set(name, task)
    }
    return task
  }
  function track(task: Promise<unknown>) {
    // Consume failures here; each section retains its own error UI.
    const settled = task.catch(() => {})
    if (phase.value === 'loading') content.add(settled)
    return settled
  }
  function start(prepare: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (running) return running
    const own = ++generation
    lifetime = new AbortController()
    const signal = lifetime.signal
    phase.value = 'loading'; error.value = ''; content.clear()
    performance.mark('openfy:startup:start')
    running = (async () => {
      try {
        await startupDeadline(prepare, STARTUP_ESSENTIAL_TIMEOUT, signal)
        signal.throwIfAborted()
        coreReady.value = true
        // Mount the actual route under the screen; its initial loaders register their work.
        await nextTick()
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        await waitForStartupContent(content, undefined, signal)
        signal.throwIfAborted()
        if (own !== generation) return
        performance.mark('openfy:startup:prepared')
        performance.measure('openfy:startup', 'openfy:startup:start', 'openfy:startup:prepared')
        phase.value = 'revealing'
      } catch (failure) {
        if (own !== generation || signal.aborted) return
        error.value = failure instanceof Error ? failure.message : 'No se pudo abrir Openfy. Vuelve a intentarlo.'
        phase.value = 'error'
      } finally { if (own === generation) running = undefined }
    })()
    return running
  }
  function complete() { if (phase.value === 'revealing') { phase.value = 'ready'; content.clear() } }
  function cancel() { generation++; lifetime?.abort(); running = undefined; content.clear() }
  return { phase, coreReady, error, blocked, visible, stage, track, start, complete, cancel }
})
