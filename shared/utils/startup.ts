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

/** How long the PC gets to answer when cached music can open instead, and without a cache. */
export const REACHABILITY_TIMEOUT = 3_000
export const REQUEST_TIMEOUT = 8_000
/** Reconnection attempts while the PC is unreachable: quick at first, then every 30 seconds. */
export const RECONNECT_DELAYS = [3_000, 6_000, 12_000, 30_000] as const
export function reconnectDelay(attempt: number) { return RECONNECT_DELAYS[Math.min(Math.max(attempt, 0), RECONNECT_DELAYS.length - 1)]! }

/**
 * A signal that aborts when the parent aborts or after the deadline. ofetch ignores its own
 * `timeout` whenever a `signal` is passed, so callers that cancel must also carry the deadline here.
 * A host that never answers (an offline Tailscale peer) would otherwise hold the request open.
 */
export function deadlineSignal(milliseconds: number, parent?: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort(parent?.reason)
  const timer = setTimeout(() => controller.abort(new DOMException('El PC no respondió a tiempo.', 'TimeoutError')), milliseconds)
  if (parent?.aborted) abort()
  else parent?.addEventListener('abort', abort, { once: true })
  return { signal: controller.signal, dispose() { clearTimeout(timer); parent?.removeEventListener('abort', abort) } }
}
