import type { MotionArtResult, PlaybackEntry } from '../../shared/types/music'
import { useMeteredNetwork } from './useMeteredNetwork'

/** Positive answers are kept for the session; negative answers and failures have a deadline. */
const known = new Map<string, { url?: string; retryAt: number }>()
const ABSENT_FOR = 30 * 24 * 3_600_000, UNMATCHED_FOR = 24 * 3_600_000, RETRY_AFTER = 15 * 60_000

/**
 * Common gating for motion art:
 * - appearance.motionArt enabled
 * - appearance.effects enabled
 * - prefers-reduced-motion false
 * - metered network false
 */
export function useMotionAllowed(): ComputedRef<boolean> {
  const appearance = useAppearanceStore()
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const metered = useMeteredNetwork()
  return computed(() => appearance.motionArt && appearance.effects && !reduced.value && !metered.value)
}

/** The looping cover of the album on screen, loaded only while the expanded player shows a large cover. */
export function useMotionArt(enabled: Ref<boolean>, entry: Ref<PlaybackEntry | undefined>) {
  const appearance = useAppearanceStore(), library = useLibraryStore()
  const allowed = useMotionAllowed()
  const active = computed(() => enabled.value && allowed.value)
  const album = computed(() => {
    const value = entry.value
    if (!value) return
    if (value.source === 'local') { const id = library.trackMap.get(value.trackId)?.albumId; return id ? `local:${id}` : undefined }
    return value.song.album && value.song.artists[0] ? `youtube:${value.song.artists[0]}\n${value.song.album}`.toLocaleLowerCase() : undefined
  })
  const url = ref<string>()
  let generation = 0, controller: AbortController | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  function retryAt(deadline: number) {
    if (!Number.isFinite(deadline) || !active.value || !library.connected) return
    retryTimer = setTimeout(() => { retryTimer = undefined; void update() }, Math.max(1, Math.min(deadline - Date.now(), 2_147_000_000)))
  }
  async function update() {
    const own = ++generation, key = album.value, value = entry.value
    clearTimeout(retryTimer); retryTimer = undefined
    controller?.abort(); controller = undefined
    if (!active.value || !key || !value) { url.value = undefined; return }
    const saved = known.get(key)
    if (saved && saved.retryAt > Date.now()) { url.value = saved.url; if (!saved.url) retryAt(saved.retryAt); return }
    known.delete(key)
    url.value = undefined
    if (!library.connected) return
    controller = new AbortController()
    try {
      const body = value.source === 'local' ? { entry: { source: 'local', trackId: value.trackId } }
        : { entry: { source: 'youtube', song: { artists: value.song.artists, album: value.song.album } } }
      const result = await $fetch<MotionArtResult>('/api/motion/resolve', { method: 'POST', body, retry: 0, signal: controller.signal })
      const answer = result.status === 'ready' ? { url: result.url, retryAt: Infinity }
        : { retryAt: Date.now() + Math.max(1000, result.retryAfterMs || (result.status === 'none' ? ABSENT_FOR : UNMATCHED_FOR)) }
      known.set(key, answer)
      if (own === generation) { url.value = answer.url; if (!answer.url) retryAt(answer.retryAt) }
    } catch (error) {
      if (controller?.signal.aborted || own !== generation) return
      const failure = error as { data?: { data?: { retryAfterMs?: number } } }
      const deadline = Date.now() + Math.max(1000, failure.data?.data?.retryAfterMs || RETRY_AFTER)
      known.set(key, { retryAt: deadline }); retryAt(deadline)
    }
  }
  watch([active, album, () => library.connected], () => { void update() }, { immediate: true })
  onBeforeUnmount(() => { generation++; controller?.abort(); clearTimeout(retryTimer) })
  /** A file the browser could not play is dropped for the session. */
  function failed() { clearTimeout(retryTimer); if (album.value) known.set(album.value, { retryAt: Infinity }); url.value = undefined }
  return { url, failed }
}
