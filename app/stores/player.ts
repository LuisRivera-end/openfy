import { defineStore } from 'pinia'
import { connectAudioAnalysis, ambientAnalysis } from '../lib/audio-reactivity'
import { identifyQueue, restoreQueue, reorderPending, orderPending, mixNextRound, repeatShuffleRecoveryMatches } from '../../shared/utils/queue'
import { localDatabase, readLocal, writeLocal } from '../lib/local'
import { assetUrl, streamingAssetUrl } from '../../shared/utils/media'
import { artworkUrl, localArtwork } from '../../shared/utils/artwork'
import { describePlayback, playbackKey, restorePlayback, youtubeStreamUrl } from '../../shared/utils/playback'
import type { PlaybackEntry, PlaybackEvent, PlaybackSnapshot, PlaybackSnapshotV2, PlaybackSnapshotV3, YouTubeSong } from '../../shared/types/music'
import type { ListeningContext } from '../../shared/types/telemetry'

export const usePlayerStore = defineStore('player', () => {
  const appearance = useAppearanceStore()
  const library = useLibraryStore()
  const downloads = useDownloadsStore()
  const telemetry = useTelemetryStore()
  const queue = ref<PlaybackEntry[]>([])
  const index = ref(0)
  const position = ref(0)
  const duration = ref(0)
  const playing = ref(false)
  const buffering = ref(false)
  const repeat = ref<PlaybackSnapshot['repeat']>('off')
  const shuffle = ref(false)
  const volume = ref(0.75)
  const error = ref('')
  const localAudioUnavailable = 'No se pudo abrir la copia descargada. Vuelve a descargar esta canción.'
  const expanded = ref(false)
  const queueOpen = ref(false)
  const events = ref<PlaybackEvent[]>([])
  const youtubeDurations = ref<Record<string, number>>({})
  const currentEntry = computed(() => queue.value[index.value])
  const current = computed(() => describeEntry(currentEntry.value))
  const queueTracks = computed(() => queue.value.map(describeEntry))
  const upcoming = computed(() => queue.value.slice(index.value + 1).map((entry, i) => ({ entry, track: describeEntry(entry), index: index.value + 1 + i })))
  const nextShuffleRound = computed(() => shuffle.value && repeat.value === 'all' && queue.value.length > 1 ? mixNextRound(queue.value) : undefined)
  const automaticStart = computed(() => repeat.value === 'one' ? index.value : index.value + 1)
  function* playbackCandidates(start: number) {
    const entries = queue.value
    for (let i = start; i < entries.length; i++) yield { entry: entries[i]!, index: i, nextRound: undefined }
    if (repeat.value !== 'all') return
    // After a reshuffle, scan the full new round so offline tracks cannot hide a playable one.
    const nextRound = nextShuffleRound.value
    const end = nextRound?.length ?? Math.min(start, entries.length)
    for (let i = 0; i < end; i++) yield { entry: (nextRound ?? entries)[i]!, index: i, nextRound }
  }
  const nextAutomatic = computed(() => {
    for (const { entry } of playbackCandidates(automaticStart.value)) {
      if (chooseAsset(entry)) return { entry, track: describeEntry(entry) }
    }
    return null
  })
  let audio: HTMLAudioElement | undefined
  let originalQueue: PlaybackEntry[] = []
  let currentAsset = ''
  let failedTracks = new Set<string>()
  let lastSaved = 0
  const activityId = crypto.randomUUID()
  let resumingUpdate = false
  const tabResumeKey = 'openfy-update-session'
  function sessionSnapshot(): PlaybackSnapshotV3 {
    return { version: 3, queue: queue.value, originalOrder: originalQueue.map(entry => entry.queueId!), index: index.value,
      position: position.value, repeat: repeat.value, shuffle: shuffle.value, volume: volume.value,
      ...(shuffle.value && repeat.value === 'all' && queue.value.length - index.value > repeatShuffleRecoveryMatches ? { repeatShuffleMigrated: true } : {}) }
  }
  function checkpointTab() {
    // sessionStorage belongs to this tab. Two paused tabs can have different queues.
    sessionStorage.setItem(tabResumeKey, JSON.stringify(sessionSnapshot()))
    resumingUpdate = true
  }
  function cancelTabCheckpoint() {
    resumingUpdate = false
    sessionStorage.removeItem(tabResumeKey)
  }
  let updateChallenge: string | undefined, serverMaintenance = false, preparingSession = false
  let clientId = ''
  let wantsPlayback = false
  let pendingRestorePosition = 0
  let pendingSeekPosition: number | null = null
  let seekAttempts = 0
  let startedCurrent = false

  function songDuration(song: YouTubeSong) { return youtubeDurations.value[song.videoId] ?? song.duration }

  function describeEntry(entry: PlaybackEntry | undefined) {
    const track = describePlayback(entry, library.trackMap)
    const saved = entry?.source === 'youtube' ? library.youtubeSongMap.get(entry.song.videoId) : undefined
    const record = track && downloads.records[track.id]
    return track && entry?.source === 'youtube' ? { ...track, duration: saved?.localAudio?.duration || songDuration(entry.song) || 0,
      artwork: record?.assetId ? localArtwork(record.artwork) : saved?.localAudio ? saved.localAudio.artwork : track.artwork,
      palette: saved?.localAudio?.palette || track.palette, favorite: saved?.favorite ?? false } : track
  }

  function syncDuration() {
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return
    duration.value = audio.duration
    const entry = currentEntry.value
    if (entry?.source === 'youtube') {
      youtubeDurations.value[entry.song.videoId] = audio.duration
      // Save the measured length for paused restoration and duplicate queue entries.
      for (const item of [...queue.value, ...originalQueue]) {
        if (item.source === 'youtube' && item.song.videoId === entry.song.videoId) item.song.duration = audio.duration
      }
    }
    updateMediaPosition()
    void persist()
  }

  function applyPendingSeek() {
    if (!audio || pendingSeekPosition === null || audio.readyState < 2 || audio.seeking || seekAttempts >= 3) return
    if (Math.abs(audio.currentTime - pendingSeekPosition) <= 0.1) {
      pendingSeekPosition = null
      pendingRestorePosition = 0
      return
    }
    seekAttempts++
    pendingRestorePosition = 0
    audio.currentTime = pendingSeekPosition
  }

  function log(type: string, detail?: string) {
    const event: PlaybackEvent = { at: Date.now(), type, trackId: current.value?.id || null,
      position: position.value, visibility: document.visibilityState, detail }
    events.value = [...events.value.slice(-499), event]
    void localDatabase().events.add(event).then(async () => {
      const count = await localDatabase().events.count()
      if (count > 500) {
        const oldest = await localDatabase().events.orderBy('at').limit(count - 500).primaryKeys()
        await localDatabase().events.bulkDelete(oldest)
      }
    }).catch(() => {})
  }

  function savePlayback() {
    return writeLocal('playback', sessionSnapshot())
  }

  function persist() { return resumingUpdate ? Promise.resolve() : savePlayback().catch(() => {}) }

  function readyForUpdate() {
    return !playing.value && !buffering.value && !library.importing && !document.querySelector('dialog[open]:not(.immersive)') &&
      !Object.values(downloads.records).some(record => ['preparing', 'downloading', 'queued'].includes(record.state))
  }
  async function activity() {
    if (!library.connected || !clientId) return
    try {
      const reply = await $fetch<{ challenge?: string; maintenance: boolean }>('/api/activity', {
        method: 'POST', body: { clientId: activityId, playing: playing.value, ready: readyForUpdate(), ack: updateChallenge }, retry: 0,
      })
      serverMaintenance = reply.maintenance
      if (reply.challenge && updateChallenge !== reply.challenge && readyForUpdate() && !preparingSession) {
        preparingSession = true
        try { await savePlayback(); await telemetry.checkpoint(); updateChallenge = reply.challenge; await activity() } finally { preparingSession = false }
      }
    } catch { /* A suspended or offline client cannot confirm an update. */ }
  }

  function updateMediaPosition() {
    if (!navigator.mediaSession || !Number.isFinite(duration.value) || duration.value <= 0) return
    try { navigator.mediaSession.setPositionState({ duration: duration.value, position: Math.min(position.value, duration.value), playbackRate: 1 }) } catch { /* Optional in Safari. */ }
  }

  /** Lock screen and Control Center artwork: sized square renditions so the system can choose one. */
  function mediaArtwork(source?: string | null): MediaImage[] {
    if (!source) return []
    const sized = ([512, 1024] as const).map(size => ({ src: new URL(artworkUrl(source, size)!, location.origin).href, sizes: `${size}x${size}`, type: 'image/webp' }))
    return source.startsWith('/') ? sized : [...sized, { src: source }]
  }

  function updateMediaMetadata() {
    const track = current.value
    if (!navigator.mediaSession || !track) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album,
      artwork: mediaArtwork(track.artwork) })
    registerMediaActions()
  }

  let mediaActions: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> | undefined
  /** Idempotent; see the re-registration listeners in initialize(). */
  function registerMediaActions() {
    if (!navigator.mediaSession || !mediaActions) return
    for (const [action, handler] of Object.entries(mediaActions)) {
      try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler!) } catch { /* Unsupported action. */ }
    }
    // With seek handlers (or no track handlers), iOS shows ±10 s skips instead of previous/next.
    for (const action of ['seekforward', 'seekbackward'] as MediaSessionAction[]) {
      try { navigator.mediaSession.setActionHandler(action, null) } catch { /* Unsupported action. */ }
    }
  }

  function chooseAsset(entry = currentEntry.value) {
    if (entry?.source === 'youtube') {
      const record = downloads.records[playbackKey(entry)]
      if (record?.state === 'ready') return assetUrl(record.assetId)
      if (record?.state === 'error' && record.assetId) return null
      const saved = library.youtubeSongMap.get(entry.song.videoId)
      if (saved?.localAudio && library.connected) return assetUrl(saved.localAudio.asset.id)
      return library.connected && navigator.onLine ? youtubeStreamUrl(entry.song.videoId) : null
    }
    const track = entry?.source === 'local' ? library.trackMap.get(entry.trackId) : undefined
    if (!track) return null
    const record = downloads.records[track.id]
    if (record?.state === 'ready') return record.assetId
    if (!library.connected) return null
    const isPhone = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    if (track.format === 'FLAC' && !isPhone && audio?.canPlayType(track.original.mime)) return track.original.id
    return track.mobile?.id || null
  }

  /**
   * Only verified downloads are served by the service worker. Streams bypass it (see sw.ts):
   * a paused media element keeps its request open, and the worker has nothing to add to a stream.
   */
  function mediaUrl(asset: string) {
    const id = asset.startsWith('/api/assets/') ? decodeURIComponent(asset.slice('/api/assets/'.length)) : asset.startsWith('/') ? undefined : asset
    if (id === undefined) return asset
    return Object.values(downloads.records).some(record => record.state === 'ready' && record.assetId === id) ? assetUrl(id) : streamingAssetUrl(id)
  }

  function loadCurrent(autoplay: boolean, restorePosition = 0) {
    if (!audio || !current.value) return
    if (autoplay) connectAudioAnalysis(audio)
    telemetry.reset(restorePosition)
    wantsPlayback = autoplay
    startedCurrent = false
    pendingSeekPosition = null
    seekAttempts = 0
    error.value = ''
    if (current.value.source === 'youtube' && !autoplay) {
      currentAsset = ''
      pendingRestorePosition = restorePosition
      position.value = restorePosition
      duration.value = current.value.duration
      buffering.value = false
      audio.removeAttribute('src')
      audio.load()
      updateMediaMetadata()
      void persist()
      return true
    }
    const asset = chooseAsset()
    if (!asset) {
      audio.removeAttribute('src'); audio.load()
      error.value = current.value.source === 'youtube' ? 'Para escuchar YouTube Music necesitas conexión con tu PC e Internet.'
        : library.connected ? 'Esta canción sigue preparándose en el PC. Puedes saltarla.' : 'Esta canción no está descargada. Puedes saltarla.'
      playing.value = false
      buffering.value = false
      log('unavailable')
      return false
    }
    currentAsset = asset
    pendingRestorePosition = restorePosition
    position.value = restorePosition
    duration.value = current.value.duration
    buffering.value = autoplay
    updateMediaMetadata()
    audio.src = mediaUrl(asset)
    // Keep play() in the original user gesture. Offline reads happen in the service worker.
    if (autoplay) requestPlay()
    void persist()
    return true
  }

  function requestPlay() {
    if (serverMaintenance) { error.value = 'Openfy está reiniciando el servidor. Vuelve a intentarlo en unos segundos.'; void activity(); return }
    if (!audio || !current.value) return
    if (!audio.getAttribute('src') || audio.error) { loadCurrent(true, position.value); return }
    wantsPlayback = true
    error.value = ''
    const requestedSource = audio.getAttribute('src')
    connectAudioAnalysis(audio)
    void audio.play().catch((reason: DOMException) => {
      if (reason.name === 'AbortError' || audio?.getAttribute('src') !== requestedSource) return
      buffering.value = false
      playing.value = false
      error.value = reason.name === 'NotAllowedError' ? 'Toca reproducir para continuar.'
        : current.value?.source === 'youtube' ? currentAsset.startsWith('/api/assets/') ? localAudioUnavailable
          : 'No se pudo reproducir esta canción de YouTube. Comprueba la conexión y toca reproducir para reintentar.'
          : 'No se pudo reproducir. Revisa la conexión o salta esta canción.'
      log('play-rejected', reason.name)
    })
  }

  function playTracks(ids: string[], start = 0, context?: ListeningContext) {
    startQueue(ids.map(trackId => ({ source: 'local', trackId })), start, false, context)
  }

  function playYouTube(songs: YouTubeSong[], start = 0, context?: ListeningContext) {
    startQueue(songs.map(song => ({ source: 'youtube', song })), start, false, context)
  }

  function startQueue(entries: PlaybackEntry[], start: number, shuffled = false, context?: ListeningContext) {
    if (!entries.length) return
    audio?.pause()
    queue.value = identifyQueue(entries.map(({ context: _context, queueId: _queueId, ...entry }) => ({ ...entry, ...(context ? { context: { ...context } } : {}) })))
    originalQueue = [...queue.value]
    if (shuffled) queue.value = orderPending(queue.value, -1, [], true)
    index.value = Math.max(0, Math.min(start, entries.length - 1))
    telemetry.select(queue.value[index.value]!)
    shuffle.value = shuffled
    failedTracks.clear()
    loadCurrent(true)
    log('queue-started')
  }

  function toggle() {
    if (!audio || !current.value) return
    // A pause during buffering never gets a 'playing' event to clear the flag.
    if (playing.value) { wantsPlayback = false; audio.pause(); buffering.value = false }
    else {
      failedTracks.clear()
      if (!audio.getAttribute('src') || audio.error || chooseAsset() !== currentAsset) loadCurrent(true, position.value)
      else requestPlay()
    }
  }

  function advance(direction: number, automatic = false) {
    if (!audio || !queue.value.length) return
    if (direction === -1 && position.value > 3) { seek(0); return }
    const start = automatic ? automaticStart.value : Math.max(0, index.value + direction)
    if (start >= queue.value.length && repeat.value !== 'all') {
      wantsPlayback = false; audio.pause(); buffering.value = false; log('queue-ended'); return
    }
    audio.pause()
    for (const candidate of playbackCandidates(start)) {
      if (candidate.nextRound && candidate.index === 0) queue.value = candidate.nextRound
      index.value = candidate.index
      telemetry.select(candidate.entry)
      if (loadCurrent(true)) { log('next-track'); return }
      if (!automatic) return
    }
    audio.pause()
    buffering.value = false
    error.value = 'No quedan canciones disponibles en esta cola.'
  }

  function seek(seconds: number) {
    if (!audio) return
    telemetry.sample(audio.currentTime, audio.duration, playing.value && !buffering.value)
    void telemetry.checkpoint()
    const target = Math.max(0, Math.min(Number.isFinite(duration.value) ? duration.value : 0, seconds))
    telemetry.reset(target)
    pendingSeekPosition = target
    seekAttempts = 0
    if (audio.readyState >= 2) {
      if (Math.abs(audio.currentTime - target) < 0.01) pendingSeekPosition = null
      else audio.currentTime = target
    } else pendingRestorePosition = target
    position.value = target
    updateMediaPosition()
    log('seek')
    void persist()
  }

  function toggleShuffle() {
    if (!currentEntry.value) return
    if (!shuffle.value) originalQueue = [...queue.value]
    queue.value = orderPending(queue.value, index.value, originalQueue.map(entry => entry.queueId!), !shuffle.value)
    shuffle.value = !shuffle.value
    void persist()
  }
  function moveInQueue(id: string, beforeId?: string) {
    queue.value = reorderPending(queue.value, index.value, id, beforeId)
    if (!shuffle.value) originalQueue = [...queue.value]
    void persist()
  }

  function cycleRepeat() {
    repeat.value = repeat.value === 'off' ? 'all' : repeat.value === 'all' ? 'one' : 'off'
    void persist()
  }

  function setVolume(value: number) {
    volume.value = Math.min(1, Math.max(0, value))
    if (audio) audio.volume = volume.value
    void persist()
  }

  function enqueue(id: string, context?: ListeningContext) { enqueueEntry({ source: 'local', trackId: id, ...(context ? { context: { ...context } } : {}) }) }
  function enqueueYouTube(song: YouTubeSong, context?: ListeningContext) { enqueueEntry({ source: 'youtube', song, ...(context ? { context: { ...context } } : {}) }) }
  function enqueueEntry(entry: PlaybackEntry) {
    queue.value.push({ ...entry, queueId: crypto.randomUUID() })
    originalQueue.push(queue.value[queue.value.length - 1]!)
    void persist()
  }
  function jump(i: number) { if (i >= 0 && i < queue.value.length) { audio?.pause(); index.value = i; telemetry.select(queue.value[i]!); failedTracks.clear(); loadCurrent(true) } }
  function removeFromQueue(i: number) {
    if (i < 0 || i >= queue.value.length || i === index.value) return
    const entry = queue.value[i]
    queue.value.splice(i, 1)
    const originalIndex = originalQueue.findIndex(item => item.queueId === entry?.queueId)
    if (originalIndex !== -1) originalQueue.splice(originalIndex, 1)
    if (i < index.value) index.value--
    void persist()
  }

  async function initialize() {
    if (audio) return
    clientId = await readLocal<string>('clientId') || crypto.randomUUID()
    await writeLocal('clientId', clientId)
    await telemetry.initialize(clientId)
    events.value = await localDatabase().events.orderBy('at').toArray().catch(() => [])
    audio = new Audio()
    audio.volume = volume.value
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const updateAmbient = () => ambientAnalysis(expanded.value && playing.value && appearance.effects && !document.hidden && !reduced.matches)
    watch([expanded, playing, () => appearance.effects], updateAmbient)
    document.addEventListener('visibilitychange', updateAmbient); reduced.addEventListener('change', updateAmbient)
    audio.addEventListener('playing', updateAmbient)
    audio.hidden = true
    audio.dataset.testid = 'audio-engine'
    audio.crossOrigin = 'anonymous'
    document.body.appendChild(audio)
    audio.preload = 'metadata'
    audio.setAttribute('playsinline', '')
    const sessionNavigator = navigator as Navigator & { audioSession?: { type: string } }
    if (sessionNavigator.audioSession) { try { sessionNavigator.audioSession.type = 'playback' } catch { /* Experimental API. */ } }
    audio.addEventListener('play', () => { playing.value = true; activity(); log('play'); if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing' })
    audio.addEventListener('pause', () => { telemetry.sample(audio!.currentTime, audio!.duration, false); void telemetry.checkpoint(); playing.value = false; activity(); log('pause'); void persist(); if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused' })
    audio.addEventListener('playing', () => { telemetry.sample(audio!.currentTime, audio!.duration, true); startedCurrent = true; buffering.value = false; failedTracks.clear(); log('playing') })
    audio.addEventListener('waiting', () => { telemetry.sample(audio!.currentTime, audio!.duration, false); buffering.value = true; log('waiting') })
    audio.addEventListener('seeking', () => telemetry.reset(audio!.currentTime))
    audio.addEventListener('durationchange', syncDuration)
    audio.addEventListener('loadedmetadata', () => {
      syncDuration()
      if ((pendingRestorePosition || pendingSeekPosition !== null) && Number.isFinite(duration.value)) {
        const target = Math.min(pendingSeekPosition ?? pendingRestorePosition, duration.value)
        pendingSeekPosition = Math.abs(audio!.currentTime - target) < 0.01 ? null : target
        position.value = target
        pendingRestorePosition = 0
        applyPendingSeek()
      }
      updateMediaPosition()
    })
    audio.addEventListener('loadeddata', applyPendingSeek)
    audio.addEventListener('canplay', applyPendingSeek)
    audio.addEventListener('progress', applyPendingSeek)
    audio.addEventListener('timeupdate', () => {
      // Safari can emit a zero timeupdate while an asynchronous seek is pending.
      // Keep the requested position in the snapshot until the seek completes.
      if (pendingRestorePosition || pendingSeekPosition !== null) return
      position.value = audio!.currentTime
      telemetry.sample(audio!.currentTime, audio!.duration, playing.value && !buffering.value && !audio!.seeking)
      if (Date.now() - lastSaved > 2500) { lastSaved = Date.now(); void persist(); updateMediaPosition() }
    })
    audio.addEventListener('seeked', () => {
      if (pendingSeekPosition !== null && Math.abs(audio!.currentTime - pendingSeekPosition) > 0.5) { applyPendingSeek(); return }
      pendingSeekPosition = null
      telemetry.reset(audio!.currentTime, !audio!.paused && !buffering.value)
      position.value = audio!.currentTime
      updateMediaPosition()
      void persist()
    })
    audio.addEventListener('ended', () => {
      telemetry.sample(audio!.currentTime, audio!.duration, false); void telemetry.checkpoint()
      if (!wantsPlayback) return
      // Some native decoders report completion without ever starting playback.
      // Keep that failure on the selected song instead of exhausting the queue.
      if (!startedCurrent) {
        wantsPlayback = false; audio!.pause(); playing.value = false; buffering.value = false
        error.value = 'Este navegador no pudo iniciar el audio. Toca reproducir para reintentar.'
        activity(); log('premature-ended', JSON.stringify({ source: current.value?.source, readyState: audio!.readyState, duration: audio!.duration, currentTime: audio!.currentTime })); return
      }
      log('ended'); advance(1, true)
    })
    audio.addEventListener('error', () => {
      telemetry.sample(audio!.currentTime, audio!.duration, false); void telemetry.checkpoint()
      buffering.value = false
      const entry = currentEntry.value
      const track = entry?.source === 'local' ? library.trackMap.get(entry.trackId) : undefined
      if (!wantsPlayback) { log('restore-unavailable'); return }
      if (entry?.source === 'youtube' && currentAsset.startsWith('/api/assets/')) {
        void downloads.invalidate(playbackKey(entry))
        error.value = localAudioUnavailable
        wantsPlayback = false; playing.value = false; activity(); log('youtube-local-unavailable'); return
      }
      if (track?.mobile && currentAsset === track.original.id && track.mobile.id !== currentAsset) {
        currentAsset = track.mobile.id
        audio!.src = mediaUrl(currentAsset)
        requestPlay()
        log('mobile-fallback')
        return
      }
      log('media-error', JSON.stringify({ source: current.value?.source, code: audio?.error?.code,
        message: audio?.error?.message, readyState: audio?.readyState, networkState: audio?.networkState, startedCurrent }))
      if (entry) failedTracks.add(playbackKey(entry))
      if (entry?.source === 'youtube') {
        error.value = 'No se pudo reproducir esta canción de YouTube. Comprueba la conexión y toca reproducir para reintentar.'
        wantsPlayback = false; playing.value = false; activity(); return
      }
      if (failedTracks.size < queue.value.length && index.value < queue.value.length - 1) advance(1, true)
      else { error.value = 'No se pudo reproducir esta canción. Comprueba la descarga o la conexión con el PC.'; playing.value = false; activity() }
    })
    mediaActions = {
      play: () => requestPlay(), pause: () => { wantsPlayback = false; audio?.pause() },
      nexttrack: () => advance(1), previoustrack: () => advance(-1),
      seekto: details => seek(details.seekTime || 0),
    }
    registerMediaActions()
    // WebKit drops handlers registered before the element is "Now Playing" and whenever that
    // session restarts (first sound, new source), then shows its default ±10 s skips.
    audio.addEventListener('play', registerMediaActions)
    audio.addEventListener('playing', registerMediaActions)
    audio.addEventListener('loadedmetadata', registerMediaActions)
    let tabSnapshot: PlaybackSnapshotV3 | undefined
    try { const value = sessionStorage.getItem(tabResumeKey); if (value) tabSnapshot = JSON.parse(value) } catch { /* Normal restoration uses IndexedDB. */ }
    const stored = tabSnapshot ?? await readLocal<PlaybackSnapshot | PlaybackSnapshotV2 | PlaybackSnapshotV3>('playback')
    if (stored) await restoreSession(stored)
    if (tabSnapshot) cancelTabCheckpoint()
    watch(() => {
      const entry = currentEntry.value
      return entry?.source === 'youtube' ? library.youtubeSongMap.get(entry.song.videoId)?.localAudio?.asset.id : undefined
    }, id => {
      const entry = currentEntry.value
      if (!id || entry?.source !== 'youtube' || currentAsset !== youtubeStreamUrl(entry.song.videoId) || !audio?.getAttribute('src')) return
      const resume = wantsPlayback, at = audio.currentTime
      audio.pause()
      loadCurrent(resume, at)
      log('youtube-downloaded')
    })
    watch([buffering, () => library.importing, () => Object.values(downloads.records).some(record => ['preparing', 'queued', 'downloading'].includes(record.state))], activity)
    document.addEventListener('toggle', event => { if (event.target instanceof HTMLDialogElement) void activity() }, true)
    // The 10 s heartbeat also keeps the server's 90 s client expiry from dropping a live page.
    activity(); setInterval(activity, 10000)
    setInterval(() => { if (audio) telemetry.sample(audio.currentTime, audio.duration, !audio.paused && !audio.seeking && !buffering.value); void telemetry.checkpoint() }, 10000)
    document.addEventListener('visibilitychange', () => { if (audio) telemetry.sample(audio.currentTime, audio.duration, !audio.paused && !audio.seeking && !buffering.value); void telemetry.checkpoint(); log('visibility'); activity(); void persist() })
    window.addEventListener('pagehide', () => {
      if (audio) telemetry.sample(audio.currentTime, audio.duration, !audio.paused && !audio.seeking && !buffering.value)
      void telemetry.checkpoint()
      void persist()
      if (clientId) navigator.sendBeacon('/api/activity', new Blob([JSON.stringify({ clientId: activityId, playing: false, closed: true })], { type: 'application/json' }))
    })
    // Space and the other keyboard shortcuts live in app/plugins/shortcuts.client.ts.
  }

  async function exportDiagnostics() {
    const report = { ...useRuntimeConfig().public.release, exportedAt: new Date().toISOString(), userAgent: navigator.userAgent,
      standalone: matchMedia('(display-mode: standalone)').matches,
      serviceWorker: !!navigator.serviceWorker?.controller, persistentStorage: downloads.persistent,
      // Time from launch to the revealed library, to decide whether a phone cold start needs a lighter splash.
      startupMs: Math.round(performance.getEntriesByName('openfy:startup')[0]?.duration ?? -1),
      viewport: { width: innerWidth, height: innerHeight, safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim() },
      events: await localDatabase().events.orderBy('at').toArray(),
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `openfy-prueba-${Date.now()}.json`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }

  async function restoreSession(snapshot: PlaybackSnapshot | PlaybackSnapshotV2 | PlaybackSnapshotV3) {
    const saved = restoreQueue(snapshot, library.trackMap)
    audio?.pause()
    queue.value = saved.queue
    const byId = new Map(saved.queue.map(entry => [entry.queueId, entry]))
    originalQueue = saved.originalOrder.map(id => byId.get(id)!).filter(Boolean)
    index.value = saved.index; repeat.value = saved.repeat; shuffle.value = saved.shuffle
    setVolume(saved.volume)
    if (currentEntry.value) telemetry.select(currentEntry.value, true)
    loadCurrent(false, saved.position)
  }
  async function importSession(file: File) {
    try {
      const report = JSON.parse(await file.text()), snapshot = report?.playback ?? report
      if (!Array.isArray(snapshot?.queue) || !Number.isInteger(snapshot.index) || !Number.isFinite(snapshot.position) ||
        !Number.isFinite(snapshot.volume) || !['off', 'all', 'one'].includes(snapshot.repeat) ||
        (snapshot.version !== undefined && ![2,3].includes(snapshot.version))) throw Error()
      if (snapshot.queue.some((entry: PlaybackEntry | string) => typeof entry === 'string' ? snapshot.version !== undefined :
        !entry || !snapshot.version || (entry.source === 'local' ? !entry.trackId : entry.source !== 'youtube' || !entry.song?.videoId))) throw Error()
      await restoreSession(snapshot)
      if (typeof report.preferences?.effects === 'boolean') appearance.effects = report.preferences.effects
      await savePlayback()
    } catch { error.value = 'No se pudo importar la sesión. Comprueba el archivo de Openfy.' }
  }
  async function exportDesktopSession() {
    await savePlayback()
    const report = { version: 1, exportedAt: new Date().toISOString(),
      playback: await readLocal<PlaybackSnapshotV3>('playback'), preferences: { effects: appearance.effects } }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'openfy-sesion-escritorio.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }

  /** Playback clock read every frame by per-word lyrics; timeupdate alone is too coarse for a word sweep. */
  function livePosition() { return pendingSeekPosition ?? (audio && !audio.seeking ? audio.currentTime : position.value) }
  return { livePosition, queue, queueTracks, upcoming, nextAutomatic, moveInQueue, persist, savePlayback, checkpointTab, cancelTabCheckpoint, readyForUpdate, index, position, duration, playing, buffering, repeat, shuffle, volume, error, expanded, queueOpen, current, events, songDuration,
    initialize, playTracks, playYouTube, playEntries: (entries: PlaybackEntry[], start = 0, context?: ListeningContext) => startQueue(entries, start, false, context),
    playCollection: (entries: PlaybackEntry[], options: { shuffle?: boolean; context?: ListeningContext } = {}) => startQueue(entries, 0, options.shuffle, options.context),
    toggle, advance, seek, toggleShuffle, cycleRepeat, setVolume, enqueue, enqueueYouTube, jump, removeFromQueue, exportDiagnostics, exportDesktopSession, importSession }
})
