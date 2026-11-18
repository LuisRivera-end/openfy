import type { YouTubeAlbum, YouTubeArtist, YouTubeSong } from '../../shared/types/music'
export type SearchKind = 'song' | 'artist' | 'album'
export type SearchCategory = 'all' | SearchKind
type SearchItem = YouTubeSong | YouTubeArtist | YouTubeAlbum
interface SearchBucket { items: SearchItem[]; cursor: string | null; status: 'idle' | 'loading' | 'success' | 'error'; error: string; expired: boolean }
const emptyBucket = (): SearchBucket => ({ items: [], cursor: null, status: 'idle', error: '', expired: false })
export const searchCategories: { key: SearchCategory; label: string }[] = [
  { key: 'all', label: 'Todo' }, { key: 'song', label: 'Canciones' }, { key: 'artist', label: 'Artistas' }, { key: 'album', label: 'Álbumes' },
]
const fields = { song: 'songs', artist: 'artists', album: 'albums' } as const
const normalize = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
/** Shared by the persistent shell field and the results. Provider cursors live only for this session. */
export const useSearchStore = defineStore('search', () => {
  const library = useLibraryStore()
  const query = ref(''), category = ref<SearchCategory>('all')
  const buckets = reactive<Record<SearchKind, SearchBucket>>({ song: emptyBucket(), artist: emptyBucket(), album: emptyBucket() })
  const positions = reactive<Record<SearchCategory, number>>({ all: 0, song: 0, artist: 0, album: 0 })
  const online = ref(true), active = ref(false)
  const disconnected = computed(() => !online.value || (!library.connected && !library.loading))
  const valid = computed(() => query.value.trim().length >= 2)
  const songs = computed(() => buckets.song.items as YouTubeSong[])
  const artists = computed(() => buckets.artist.items as YouTubeArtist[])
  const albums = computed(() => buckets.album.items as YouTubeAlbum[])
  const settled = computed(() => Object.values(buckets).every(bucket => bucket.status === 'success' || bucket.status === 'error'))
  const featured = computed(() => {
    if (!settled.value) return null
    const needle = normalize(query.value)
    const artist = artists.value.find(item => normalize(item.name) === needle)
    const song = songs.value.find(item => normalize(item.title) === needle)
    const album = albums.value.find(item => normalize(item.title) === needle)
    return artist ? { kind: 'artist' as const, item: artist } : song ? { kind: 'song' as const, item: song }
      : album ? { kind: 'album' as const, item: album } : songs.value[0] ? { kind: 'song' as const, item: songs.value[0] }
        : artists.value[0] ? { kind: 'artist' as const, item: artists.value[0] } : albums.value[0] ? { kind: 'album' as const, item: albums.value[0] } : null
  })
  const controllers = new Map<SearchKind, AbortController>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  function cancel() {
    clearTimeout(timer); generation++
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    for (const bucket of Object.values(buckets)) if (bucket.status === 'loading') bucket.status = bucket.items.length ? 'success' : 'idle'
  }
  async function load(kind: SearchKind, refresh = false) {
    const bucket = buckets[kind]
    if (!active.value || !valid.value || disconnected.value || !library.connected || bucket.status === 'loading') return
    if (!refresh && bucket.status === 'success' && !bucket.cursor) return
    const own = generation, cursor = refresh ? null : bucket.cursor
    const controller = new AbortController(); controllers.set(kind, controller)
    bucket.status = 'loading'; bucket.error = ''
    try {
      const result = await $fetch<{ songs?: YouTubeSong[]; artists?: YouTubeArtist[]; albums?: YouTubeAlbum[]; nextCursor?: string | null }>('/api/music/search', {
        query: { q: query.value.trim(), ...(kind !== 'song' ? { type: kind } : {}), ...(cursor ? { cursor } : {}) },
        signal: controller.signal, timeout: 20000, retry: 0,
      })
      if (own !== generation) return
      const identity = (item: SearchItem) => 'videoId' in item ? item.videoId : item.id
      const seen = new Set(cursor ? bucket.items.map(identity) : [])
      const incoming = (result[fields[kind]] || []).filter(item => { const id = identity(item); if (seen.has(id)) return false; seen.add(id); return true })
      bucket.items = cursor ? [...bucket.items, ...incoming] : incoming
      bucket.cursor = result.nextCursor ?? null; bucket.status = 'success'; bucket.expired = false
      if (refresh) positions[kind] = 0
    } catch (reason) {
      if (own !== generation) return
      const failure = reason as { statusCode?: number; data?: { statusCode?: number; message?: string } }
      bucket.error = failure.data?.message || 'No se pudo completar la búsqueda. Vuelve a intentarlo.'
      bucket.expired = failure.statusCode === 410 || failure.data?.statusCode === 410; bucket.status = 'error'
    } finally { if (controllers.get(kind) === controller) controllers.delete(kind) }
  }
  function resume(immediate = false) {
    clearTimeout(timer)
    if (!active.value || !valid.value || disconnected.value || !library.connected) return
    const run = () => { for (const kind of ['song', 'artist', 'album'] as const) if (buckets[kind].status === 'idle') void load(kind) }
    if (immediate) run(); else timer = setTimeout(run, 350)
  }
  function edit(value: string) {
    if (value === query.value) return
    cancel(); query.value = value.slice(0, 200)
    for (const kind of ['song', 'artist', 'album'] as const) Object.assign(buckets[kind], emptyBucket())
    for (const key of Object.keys(positions) as SearchCategory[]) positions[key] = 0
    if (!query.value.trim()) category.value = 'all'
    resume()
  }
  function activate() { active.value = true; resume() }
  function deactivate() { active.value = false; cancel() }
  watch([() => library.connected, online], () => { if (disconnected.value) cancel(); else resume() })
  return { query, category, buckets, positions, online, active, disconnected, valid, songs, artists, albums, settled, featured, edit, load, resume, activate, deactivate }
})
