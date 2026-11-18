import 'core-js/actual/url'
import 'core-js/actual/url-search-params'
import 'core-js/actual/structured-clone'
import 'fast-text-encoding'
import { ReadableStream } from 'web-streams-polyfill'
// Load the platform shim before the SDK barrel; this also preserves its circular parser initialization order.
import { Platform } from '../../node_modules/youtubei.js/dist/src/utils/Utils.js'

globalThis.ReadableStream = ReadableStream as typeof globalThis.ReadableStream
class MemoryCache {
  store = new Map<string, ArrayBuffer>()
  get cache_dir() { return '' }
  async get(key: string) { return this.store.get(key) }
  async set(key: string, value: ArrayBuffer) { if(this.store.size > 50) this.store.clear(); this.store.set(key,value) }
  async remove(key: string) { this.store.delete(key) }
}
Platform.load({ runtime: 'unknown', server: false, Cache: MemoryCache,
  sha1Hash: async data => globalThis.__sha1(data), uuidv4: () => globalThis.crypto.randomUUID(),
  eval: async (data, env) => JSON.parse(await globalThis.__decipher(data.output, JSON.stringify(env))),
  fetch: globalThis.fetch, Request: globalThis.Request, Response: globalThis.Response,
  Headers: globalThis.Headers, FormData: globalThis.FormData, File: globalThis.File,
  ReadableStream: globalThis.ReadableStream, CustomEvent: globalThis.CustomEvent,
})
export * from 'youtubei.js/agnostic'
