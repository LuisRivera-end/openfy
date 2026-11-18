import { defineStore } from 'pinia'
import { readLocal, writeLocal } from '../lib/local'
import type { Album, Artist, ImportJob, Library, Playlist, SavedYouTubeSong, YouTubeSong } from '../../shared/types/music'
import { collectionMap as buildCollectionMap } from '../../shared/utils/collections'

export const useLibraryStore = defineStore('library', () => {
  const tracks = ref<Library['tracks']>([])
  const playlists = ref<Playlist[]>([])
  const youtubeSongs = ref<SavedYouTubeSong[]>([])
  const youtubeSongMap = computed(() => new Map(youtubeSongs.value.map(saved => [saved.song.videoId, saved])))
  const collectionMap = computed(() => buildCollectionMap(tracks.value, youtubeSongs.value))
  function cache() { return writeLocal('library', { tracks: tracks.value, playlists: playlists.value, youtubeSongs: youtubeSongs.value }) }
  const jobs = ref<ImportJob[]>([])
  const connected = ref(false)
  const loading = ref(true)
  const importing = ref(false)
  const importLabel = ref('')
  const error = ref('')
  const conversionPaused = ref(false)
  function pinArtwork() {
    const ids = new Set(playlists.value.flatMap(list => list.trackIds))
    const sources = [...tracks.value.map(track => track.artwork), ...youtubeSongs.value.filter(saved => saved.favorite || saved.localAudio || ids.has('youtube:' + saved.song.videoId)).map(saved => saved.localAudio ? saved.localAudio.artwork : saved.song.artwork)].filter(Boolean)
    navigator.serviceWorker?.controller?.postMessage({ type: 'ARTWORK_PINS', sources })
  }
  watch([tracks, playlists, youtubeSongs], pinArtwork, { deep: true })
  if (import.meta.client) navigator.serviceWorker?.addEventListener('controllerchange', pinArtwork)
  const trackMap = computed(() => new Map(tracks.value.map(track => [track.id, track])))
  const albums = computed<Album[]>(() => {
    const groups = new Map<string, Album>()
    for (const item of collectionMap.value.values()) {
      const track = trackMap.value.get(item.id)
      const key = track?.albumId || `youtube:${item.albumId || item.artist + '\u001f' + item.album}`
      if (!groups.has(key)) groups.set(key, {
        id: key, title: item.album, artist: track?.albumArtist || item.artist,
        artwork: item.artwork, palette: item.palette, trackIds: [],
      })
      groups.get(key)!.trackIds.push(item.id)
    }
    for (const album of groups.values()) album.trackIds.sort((a, b) => {
      const left = trackMap.value.get(a), right = trackMap.value.get(b)
      return (left?.disc || 0) - (right?.disc || 0) || (left?.trackNumber || 0) - (right?.trackNumber || 0) || 0
    })
    return [...groups.values()]
  })
  const artists = computed<Artist[]>(() => {
    const groups = new Map<string, Artist>()
    for (const item of collectionMap.value.values()) {
      if (!groups.has(item.artist)) groups.set(item.artist, { name: item.artist, trackIds: [], artwork: item.artwork })
      groups.get(item.artist)!.trackIds.push(item.id)
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
  })

  async function refreshWithSignal(signal?: AbortSignal) {
    try {
      const [snapshot, importJobs, status] = await Promise.all([
        $fetch<Library>('/api/library', { timeout: 8000, retry: 0, signal }),
        $fetch<ImportJob[]>('/api/imports', { timeout: 8000, retry: 0, signal }),
        $fetch<{ conversionPaused: boolean }>('/api/status', { timeout: 8000, retry: 0, signal }),
      ])
      signal?.throwIfAborted()
      tracks.value = snapshot.tracks
      youtubeSongs.value = snapshot.youtubeSongs ?? []
      playlists.value = snapshot.playlists
      jobs.value = importJobs
      connected.value = true
      conversionPaused.value = status.conversionPaused
      await writeLocal('library', snapshot).catch(() => { error.value = 'No se pudieron guardar los metadatos en este dispositivo.' })
      void useDownloadsStore().reconcile()
    } catch (failure) { if (signal?.aborted) throw failure; connected.value = false }
    finally { loading.value = false }
  }

  async function refresh() { await refreshWithSignal() }
  async function initialize(signal?: AbortSignal) {
    const saved = await readLocal<Library>('library').catch(() => undefined)
    signal?.throwIfAborted()
    if (saved) { tracks.value = saved.tracks; playlists.value = saved.playlists; youtubeSongs.value = saved.youtubeSongs ?? [] }
    await refreshWithSignal(signal)
  }

  async function importFiles(files: FileList | File[]) {
    if (!connected.value || importing.value) return
    importing.value = true
    error.value = ''
    const supported = [...files].filter(file => /\.(mp3|aac|m4a|flac)$/i.test(file.name))
    if (!supported.length) error.value = 'Selecciona archivos MP3, AAC, M4A o FLAC.'
    for (let i = 0; i < supported.length; i++) {
      const file = supported[i]!
      importLabel.value = `${i + 1} de ${supported.length} · ${file.name}`
      try {
        if (file.size > 1024 ** 3) throw new Error('El límite es 1 GB por archivo.')
        await $fetch('/api/imports', { method: 'POST', query: { filename: file.name }, body: file,
          headers: { 'Content-Type': 'application/octet-stream' }, retry: 0, timeout: 0 })
      } catch { error.value = `No se pudo importar «${file.name}». Revisa la conexión y el espacio del PC.` }
    }
    importing.value = false
    importLabel.value = ''
    await refresh()
  }

  async function favorite(id: string) {
    const track = collectionMap.value.get(id)
    if (!track || !connected.value) return
    try {
      const favorite = !track.favorite
      await $fetch(`/api/tracks/${encodeURIComponent(id)}/favorite`, { method: 'PUT', body: { favorite }, retry: 0 })
      if (track.entry.source === 'local') trackMap.value.get(id)!.favorite = favorite
      else youtubeSongMap.value.get(track.entry.song.videoId)!.favorite = favorite
      await cache()
    } catch { error.value = 'No se pudo guardar el favorito. Comprueba la conexión con el PC.' }
  }

  async function saveYouTube(song: YouTubeSong, favorite?: boolean) {
    const saved = await $fetch<SavedYouTubeSong>('/api/music/saved', { method: 'PUT', body: { song, favorite }, retry: 0 })
    saved.localAudio ??= youtubeSongMap.value.get(song.videoId)?.localAudio
    const index = youtubeSongs.value.findIndex(item => item.song.videoId === song.videoId)
    if (index < 0) youtubeSongs.value.unshift(saved)
    else youtubeSongs.value[index] = saved
    await cache()
    return saved
  }

  async function favoriteYouTube(song: YouTubeSong) {
    if (!connected.value) return
    try { await saveYouTube(song, !youtubeSongMap.value.get(song.videoId)?.favorite) }
    catch { error.value = 'No se pudo guardar el favorito. Comprueba la conexión con el PC.' }
  }

  async function addYouTubeToPlaylist(playlist: Playlist, song: YouTubeSong) {
    if (!connected.value) return
    try {
      await saveYouTube(song)
      const id = `youtube:${song.videoId}`
      const current = playlists.value.find(item => item.id === playlist.id) ?? playlist
      if (!current.trackIds.includes(id)) await updatePlaylist(current, { trackIds: [...current.trackIds, id] })
    } catch { error.value = 'No se pudo añadir la canción a la playlist.' }
  }

  async function createPlaylist(name: string) {
    if (!connected.value) return
    try {
      const playlist = await $fetch<Playlist>('/api/playlists', { method: 'POST', body: { name } })
      playlists.value.unshift(playlist)
      await cache()
      return playlist
    } catch { error.value = 'No se pudo crear la playlist.' }
  }

  async function updatePlaylist(playlist: Playlist, changes: Partial<Pick<Playlist, 'name' | 'trackIds'>>) {
    if (!connected.value) return
    try {
      const updated = await $fetch<Playlist>(`/api/playlists/${playlist.id}`, { method: 'PUT', body: { ...playlist, ...changes } })
      Object.assign(playlist, updated)
      await cache()
      void useDownloadsStore().reconcile()
    } catch { error.value = 'La playlist cambió o se perdió la conexión. Actualiza antes de volver a intentarlo.'; await refresh() }
  }

  async function deletePlaylist(id: string) {
    if (!connected.value) return
    try { await $fetch(`/api/playlists/${id}`, { method: 'DELETE' }); await refresh() }
    catch { error.value = 'No se pudo eliminar la playlist.' }
  }

  return { tracks, trackMap, youtubeSongs, youtubeSongMap, collectionMap, playlists, albums, artists, jobs, connected, loading, importing, importLabel, error,
    conversionPaused, initialize, refresh, importFiles, favorite, favoriteYouTube, addYouTubeToPlaylist, createPlaylist, updatePlaylist, deletePlaylist }
})
