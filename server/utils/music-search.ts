import { randomUUID } from 'node:crypto'
import type { MusicSearchResults, YouTubeSong } from '../../shared/types/music'
import { MusicProviderError } from './music-errors'

export interface PageBatch<T> { items: T[]; next: (() => Promise<PageBatch<T>>) | null }
export interface MusicPage<T> { items: T[]; nextCursor: string | null }
interface PageState<T> {
  id: string; key: string; items: T[]; seen: Set<string>; next: PageBatch<T>['next']; expires: number; pending?: Promise<void>
}
interface PageOptions<T> {
  initialSize: number; nextSize: number; identity: (item: T) => string; key?: (query: string) => string
}
const TTL = 15 * 60000

/** Provider continuations stay on the server; each public cursor is safe to replay. */
export class MusicPageCache<T> {
  private states = new Map<string, PageState<T>>()
  private queries = new Map<string, string>()
  private initial = new Map<string, Promise<PageState<T>>>()
  constructor(private load: (query: string) => Promise<PageBatch<T>>, private options: PageOptions<T>, private now = Date.now) {}

  private remove(id: string, state: PageState<T>) {
    this.states.delete(id)
    if (this.queries.get(state.key) === id) this.queries.delete(state.key)
  }
  private append(state: PageState<T>, batch: PageBatch<T>) {
    for (const item of batch.items) {
      const id = this.options.identity(item)
      if (!state.seen.has(id)) { state.seen.add(id); state.items.push(item) }
    }
    state.next = batch.next
  }
  private async start(query: string, key: string) {
    const cached = this.states.get(this.queries.get(key) || '')
    if (cached) return cached
    const existing = this.initial.get(key)
    if (existing) return existing
    const pending = (async () => {
      const batch = await this.load(query)
      const state: PageState<T> = { id: randomUUID(), key, items: [], seen: new Set(), next: null, expires: this.now() + TTL }
      this.append(state, batch)
      if (this.states.size >= 100) {
        const oldest = this.states.entries().next().value!
        this.remove(oldest[0], oldest[1])
      }
      this.states.set(state.id, state)
      this.queries.set(key, state.id)
      return state
    })()
    this.initial.set(key, pending)
    try { return await pending } finally { this.initial.delete(key) }
  }
  async page(query: string, cursor?: string): Promise<MusicPage<T>> {
    for (const [id, state] of this.states) if (state.expires <= this.now()) this.remove(id, state)
    const key = this.options.key ? this.options.key(query) : query.trim()
    let state: PageState<T>
    let offset = 0
    if (cursor) {
      const match = /^([a-f0-9-]{36}):(\d{1,9})$/.exec(cursor)
      if (!match) throw new MusicProviderError('INVALID_CURSOR', 'La continuación no es válida.', 400)
      const cached = this.states.get(match[1]!)
      if (!cached) throw new MusicProviderError('SEARCH_EXPIRED', 'La consulta caducó. Actualízala para continuar.', 410)
      offset = Number(match[2])
      if (cached.key !== key || offset < this.options.initialSize || (offset - this.options.initialSize) % this.options.nextSize !== 0 || offset > cached.items.length) {
        throw new MusicProviderError('INVALID_CURSOR', 'La continuación no corresponde a esta consulta.', 400)
      }
      state = cached
    } else state = await this.start(query.trim(), key)
    state.expires = this.now() + TTL
    this.states.delete(state.id); this.states.set(state.id, state)
    const target = offset + (cursor ? this.options.nextSize : this.options.initialSize)
    let emptyBatches = 0
    const hasNext = () => state.next !== null
    while (state.items.length < target && state.next) {
      const before = state.items.length
      if (!state.pending) {
        const next = state.next
        state.pending = (async () => { this.append(state, await next()) })()
      }
      const pending = state.pending
      try { await pending } finally { if (state.pending === pending) state.pending = undefined }
      emptyBatches = state.items.length === before ? emptyBatches + 1 : 0
      if (emptyBatches >= 3 && hasNext()) throw new MusicProviderError('SEARCH_STALLED', 'YouTube Music no devolvió más resultados. Vuelve a intentarlo.')
    }
    const end = Math.min(target, state.items.length)
    return { items: state.items.slice(offset, end), nextCursor: end < state.items.length || state.next ? `${state.id}:${end}` : null }
  }
}

export interface SearchBatch { songs: YouTubeSong[]; next: (() => Promise<SearchBatch>) | null }
export class MusicSearchCache {
  private cache: MusicPageCache<YouTubeSong>
  constructor(load: (query: string) => Promise<SearchBatch>, now = Date.now) {
    const convert = (batch: SearchBatch): PageBatch<YouTubeSong> => ({ items: batch.songs, next: batch.next ? async () => convert(await batch.next!()) : null })
    this.cache = new MusicPageCache(async query => convert(await load(query)), {
      initialSize: 20, nextSize: 10, identity: song => song.videoId, key: query => query.trim().toLocaleLowerCase('es'),
    }, now)
  }
  async search(query: string, cursor?: string): Promise<MusicSearchResults> {
    const page = await this.cache.page(query, cursor)
    return { songs: page.items, nextCursor: page.nextCursor }
  }
}
