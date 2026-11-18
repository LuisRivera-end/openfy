import { diagnosticError, diagnosticTarget, sessionDiagnostic } from '../utils/session-diagnostics'

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender || !process.env.OPENFY_SESSION_LOG_DIR) return
  sessionDiagnostic('backend', 'started')
  const started = new WeakMap<object, number>()
  nitro.hooks.hook('request', event => {
    started.set(event, performance.now())
    sessionDiagnostic('http.incoming', 'started', { method: event.method, target: event.path.split('?')[0] })
  })
  nitro.hooks.hook('afterResponse', event => sessionDiagnostic('http.incoming', 'completed', {
    method: event.method, target: event.path.split('?')[0], status: event.node.res.statusCode,
    elapsedMs: Math.round(performance.now() - (started.get(event) ?? performance.now())),
  }))
  nitro.hooks.hook('error', (error, context) => sessionDiagnostic('http.incoming', 'failed', {
    method: context.event?.method, target: context.event?.path.split('?')[0],
    elapsedMs: context.event ? Math.round(performance.now() - (started.get(context.event) ?? performance.now())) : undefined,
    ...diagnosticError(error),
  }))
  const originalFetch = globalThis.fetch
  const tracedFetch: typeof fetch = async (input, init) => {
    const target = diagnosticTarget(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = init?.method || (input instanceof Request ? input.method : 'GET')
    const begin = performance.now()
    sessionDiagnostic('http.outgoing', 'started', { method, target })
    try {
      const response = await originalFetch(input, init)
      sessionDiagnostic('http.outgoing', response.ok ? 'completed' : 'failed', { method, target, status: response.status, elapsedMs: Math.round(performance.now() - begin) })
      return response
    } catch (error) {
      sessionDiagnostic('http.outgoing', 'failed', { method, target, elapsedMs: Math.round(performance.now() - begin), ...diagnosticError(error) })
      throw error
    }
  }
  globalThis.fetch = tracedFetch
  nitro.hooks.hook('close', () => { if (globalThis.fetch === tracedFetch) globalThis.fetch = originalFetch })
})
