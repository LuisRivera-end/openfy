import type { ArtistMotionEntry, MotionArtResult } from '../../shared/types/music'
import { useMeteredNetwork } from './useMeteredNetwork'

/** Positive answers are kept for the session; negative answers and failures have a deadline. */
const known = new Map<string, { url?: string; retryAt: number }>()
const ABSENT_FOR = 30 * 24 * 3_600_000, UNMATCHED_FOR = 24 * 3_600_000, RETRY_AFTER = 15 * 60_000

/**
 * Editorial header video for an artist profile (16:9), loaded when motion art and effects are enabled.
 * Shares the same gates and retry backoffs as album motion art.
 */
export function useArtistMotion(
  artistId: () => string | undefined,
  name: () => string | undefined,
  albums: () => string[],
) {
  const appearance = useAppearanceStore(), library = useLibraryStore()
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const metered = useMeteredNetwork()
  const active = computed(() => appearance.motionArt && appearance.effects && !reduced.value && !metered.value)

  const artistName = computed(() => name()?.trim())
  const artistAlbums = computed(() => [...new Set(albums().map(title => title.trim()).filter(Boolean))].sort().slice(0, 40))
  const key = computed(() => artistId() && artistName.value && JSON.stringify([artistId(), artistName.value, artistAlbums.value]) || undefined)

  const url = ref<string>()
  let generation = 0, controller: AbortController | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function retryAt(deadline: number) {
    if (!Number.isFinite(deadline) || !active.value || !library.connected) return
    retryTimer = setTimeout(() => { retryTimer = undefined; void update() }, Math.max(1, Math.min(deadline - Date.now(), 2_147_000_000)))
  }

  async function update() {
    const own = ++generation, artistKey = key.value, currentName = artistName.value
    clearTimeout(retryTimer); retryTimer = undefined
    controller?.abort(); controller = undefined

    if (!active.value || !artistKey || !currentName) {
      url.value = undefined
      return
    }

    const saved = known.get(artistKey)
    if (saved && saved.retryAt > Date.now()) {
      url.value = saved.url
      if (!saved.url) retryAt(saved.retryAt)
      return
    }

    known.delete(artistKey)
    url.value = undefined
    // Without release titles a namesake cannot be ruled out, so the banner stays.
    if (!library.connected || !artistAlbums.value.length) return

    controller = new AbortController()
    try {
      const body: { entry: ArtistMotionEntry } = {
        entry: {
          source: 'artist',
          artistId: artistId(),
          name: currentName,
          albums: artistAlbums.value,
        },
      }
      const result = await $fetch<MotionArtResult>('/api/motion/resolve', {
        method: 'POST',
        body,
        retry: 0,
        signal: controller.signal,
      })
      const answer = result.status === 'ready'
        ? { url: result.url, retryAt: Infinity }
        : { retryAt: Date.now() + Math.max(1000, result.retryAfterMs || (result.status === 'none' ? ABSENT_FOR : UNMATCHED_FOR)) }

      known.set(artistKey, answer)
      if (own === generation) {
        url.value = answer.url
        if (!answer.url) retryAt(answer.retryAt)
      }
    } catch (error) {
      if (controller?.signal.aborted || own !== generation) return
      const failure = error as { data?: { data?: { retryAfterMs?: number } } }
      const deadline = Date.now() + Math.max(1000, failure.data?.data?.retryAfterMs || RETRY_AFTER)
      known.set(artistKey, { retryAt: deadline })
      retryAt(deadline)
    }
  }

  watch([active, key, () => library.connected], () => { void update() }, { immediate: true })
  onBeforeUnmount(() => { generation++; controller?.abort(); clearTimeout(retryTimer) })

  function failed() {
    clearTimeout(retryTimer)
    const deadline = Date.now() + RETRY_AFTER
    if (key.value) known.set(key.value, { retryAt: deadline })
    url.value = undefined
    retryAt(deadline)
  }

  return { url, failed }
}
