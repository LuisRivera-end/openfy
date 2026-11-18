export const STARTUP_ESSENTIAL_TIMEOUT = 30_000
export const STARTUP_CONTENT_TIMEOUT = 5_000

/** Bound the wait, abort the work, and observe late rejections even if a provider ignores cancellation. */
export async function startupDeadline<T>(work: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort(parent?.reason)
  parent?.addEventListener('abort', abort, { once: true })
  if (parent?.aborted) abort()
  const timer = setTimeout(() => controller.abort(new Error('Openfy está tardando demasiado en abrirse. Vuelve a intentarlo.')), milliseconds)
  let interrupted: (() => void) | undefined
  try {
    controller.signal.throwIfAborted()
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        interrupted = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', interrupted, { once: true })
        if (controller.signal.aborted) interrupted()
      }),
    ])
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', abort)
    if (interrupted) controller.signal.removeEventListener('abort', interrupted)
  }
}

/** Optional work continues after the opening screen's budget expires. */
export async function waitForStartupContent(tasks: Iterable<Promise<unknown>>, milliseconds = STARTUP_CONTENT_TIMEOUT, signal?: AbortSignal): Promise<void> {
  try { await startupDeadline(() => Promise.allSettled([...tasks]).then(() => {}), milliseconds, signal) }
  catch (error) { if (signal?.aborted) throw error }
}
