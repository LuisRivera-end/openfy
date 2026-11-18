/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { createPartialResponse } from 'workbox-range-requests'
import { AUDIO_CACHE, ARTWORK_CACHE, STREAM_PARAM } from '../../shared/utils/media'
import { coordinateUpdate } from './update'
import { artworkResponse, pinArtwork } from './artwork'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> }

declare const __OPENFY_RELEASE__: string
self.addEventListener('message', event => { if (event.data?.type === 'OPENFY_VERSION') event.ports[0]?.postMessage(__OPENFY_RELEASE__) })
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
clientsClaim()
// Service worker static routing (Safari 27, Chromium): audio streams go straight to the network without waking
// this worker, so starting playback never waits for it. Downloads and artwork still use the routes below.
self.addEventListener('install', event => {
  const install = event as ExtendableEvent & { addRoutes?: (rules: unknown[]) => Promise<void> }
  if (typeof install.addRoutes !== 'function') return
  // Never let an unsupported rule fail the install: the fetch routes below already pass streams through.
  try {
    event.waitUntil(install.addRoutes([
      { condition: { urlPattern: { pathname: '/api/assets/*', search: `${STREAM_PARAM}=1` } }, source: 'network' },
      { condition: { urlPattern: { pathname: '/api/music/youtube/*/stream' } }, source: 'network' },
    ]).catch(() => {}))
  } catch { /* Synchronous rejection of the rules. */ }
})

self.addEventListener('message', event => { if (event.data?.type === 'OPENFY_UPDATE') event.waitUntil(coordinateUpdate(event)) })
self.addEventListener('message', event => { if (event.data?.type === 'ARTWORK_PINS' && Array.isArray(event.data.sources)) event.waitUntil(pinArtwork(event.data.sources.filter((source: unknown) => typeof source === 'string'))) })
// @vite-pwa/nuxt normalizes the prerendered index.html entry to '/'.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/'), { denylist: [/^\/api\//] }))

// Downloads are served from the cache, with Range support. Streaming never implicitly downloads:
// only the download manager commits verified 200 responses. Streams (?stream) are not intercepted
// at all, since this worker adds nothing to them, so a paused media element never holds a request
// open through it. A cache miss is a plain pass-through: a cloned body would be streamed through
// this worker for as long as the media element keeps reading.
registerRoute(({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/api/assets/') && !url.searchParams.has(STREAM_PARAM),
  async ({ request }) => {
    const cached = await (await caches.open(AUDIO_CACHE)).match(request)
    if (!cached) return fetch(request)
    return request.headers.has('range') ? createPartialResponse(request, cached) : cached
  })
registerRoute(({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/api/artwork/'),
  ({ request, event }) => artworkResponse(request, event))
