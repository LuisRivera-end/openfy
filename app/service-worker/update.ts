declare const self: ServiceWorkerGlobalScope
let coordinating = false
export async function coordinateUpdate(event: ExtendableMessageEvent) {
  const output = event.ports[0]
  if (!output || coordinating) { output?.postMessage({ ready: false }); return }
  coordinating = true
  const participants = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const eligible = participants.filter(client => client.url.startsWith(self.registration.scope))
  try {
    // iOS freezes hidden tabs (a Safari tab behind the installed app), so they never answer.
    // Silence from a hidden client does not block; an explicit "not ready" always does.
    // A frozen client reloads itself once it is visible again (updates store, stale controller).
    const answers = await Promise.all(eligible.map(client => new Promise<boolean | 'absent'>(resolve => {
      const channel = new MessageChannel()
      function finish(ready: boolean | 'absent') { clearTimeout(timer); channel.port1.close(); resolve(ready) }
      const timer = setTimeout(() => finish(client.visibilityState === 'hidden' ? 'absent' : false), 6000)
      channel.port1.onmessage = reply => finish(reply.data?.ready === true)
      client.postMessage({ type: 'OPENFY_UPDATE_PREPARE', automatic: event.data.automatic === true }, [channel.port2])
    })))
    const latest = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => client.url.startsWith(self.registration.scope))
    if (!answers.includes(true) || answers.includes(false) || latest.some(client => !eligible.some(known => known.id === client.id))) throw new Error('Clients unavailable')
    // Activation follows the completion of this message event. Chromium resolves skipWaiting()
    // only once activation starts, which can be held while the old worker still has work; the
    // page then waits for controllerchange (updates store) instead of this reply.
    await self.skipWaiting()
    output.postMessage({ ready: true })
  } catch {
    for (const client of eligible) client.postMessage({ type: 'OPENFY_UPDATE_RELEASE' })
    output.postMessage({ ready: false })
  } finally { coordinating = false }
}
