import { ARTWORK_CACHE } from '../../shared/utils/media'
import { artworkIdentity } from '../../shared/utils/artwork'
const META = ARTWORK_CACHE + '-metadata'
const PIN_URL = new URL('/__openfy/artwork-pins', self.location.origin).href
let serial = Promise.resolve(), lastPrune = 0
function identity(url: string) { const parsed = new URL(url); return artworkIdentity(parsed.searchParams.get('url') || parsed.pathname) }
export async function pinArtwork(sources: string[]) {
  await (await caches.open(META)).put(PIN_URL, new Response(JSON.stringify(sources.map(artworkIdentity))))
}
async function prune(force = false) {
  if (!force && Date.now() - lastPrune < 10_000) return
  lastPrune = Date.now()
  const cache = await caches.open(ARTWORK_CACHE), meta = await caches.open(META)
  const pins = new Set<string>(await (await meta.match(PIN_URL))?.json().catch(() => []) || [])
  const temporary: { request: Request; bytes: number; at: number }[] = []
  for (const request of await cache.keys()) {
    if (pins.has(identity(request.url))) continue
    const saved = await meta.match(request)
    const info = saved ? await saved.json() : { bytes: (await (await cache.match(request))!.blob()).size, at: 0 }
    temporary.push({ request, ...info })
  }
  let bytes = temporary.reduce((sum, entry) => sum + entry.bytes, 0)
  for (const entry of temporary.sort((a, b) => a.at - b.at)) {
    if (bytes <= (force ? 32 : 64) * 1024 ** 2) break
    await cache.delete(entry.request); await meta.delete(entry.request); bytes -= entry.bytes
  }
}
export async function artworkResponse(request: Request, event: ExtendableEvent) {
  const cache = await caches.open(ARTWORK_CACHE)
  const url = new URL(request.url)
  const original = url.pathname.endsWith('.webp') && url.searchParams.has('size') ? await cache.match(url.pathname) : undefined
  const cached = await cache.match(request) || original
  const response = cached || await fetch(request).catch(async error => {
    // A pre-upgrade offline download may contain only the original local cover.
    const url = new URL(request.url)
    if (url.pathname.endsWith('.webp') && url.searchParams.has('size')) {
      const original = await cache.match(url.pathname)
      if (original) return original
    }
    throw error
  })
  if (response.status === 200 && response.headers.get('content-type')?.startsWith('image/')) {
    const copy = response.clone()
    const save = async () => {
      const bytes = Number(response.headers.get('content-length')) || (await copy.clone().blob()).size
      try {
        if (!cached) await cache.put(request, copy.clone())
        await (await caches.open(META)).put(request, new Response(JSON.stringify({ bytes, at: Date.now() })))
        await prune()
      } catch {
        await prune(true).catch(() => {})
        if (!cached) {
          try {
            await cache.put(request, copy)
            await (await caches.open(META)).put(request, new Response(JSON.stringify({ bytes, at: Date.now() })))
          } catch { /* Return the network image even if storage remains full. */ }
        }
      }
    }
    serial = serial.catch(() => {}).then(save)
    event.waitUntil(serial.catch(() => {}))
  }
  return response
}
