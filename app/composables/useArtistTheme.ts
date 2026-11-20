import type { Ref } from 'vue'
import type { ArtistTheme } from '../../shared/types/music'
import { ARTIST_THEME_SAMPLE, NEUTRAL_ARTIST_THEME, artistTheme } from '../../shared/utils/artist-theme'
import { loadArtwork } from './useArtwork'

const cache = shallowReactive(new Map<string, { source: string; theme: ArtistTheme }>())
const CACHE_LIMIT = 64

function rememberArtistTheme(key: string, source: string, theme: ArtistTheme) {
  cache.delete(key)
  cache.set(key, { source, theme })
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
}

export function knownArtistTheme(key: string): ArtistTheme | undefined {
  return cache.get(key)?.theme
}

export function useArtistShellPalette() {
  return useState<{ path: string; theme: ArtistTheme } | null>('artist-shell-palette', () => null)
}

export function useArtistShellTheme(theme: () => ArtistTheme | undefined) {
  const route = useRoute(), palette = useArtistShellPalette()
  let currentPath: string | undefined
  function clear() {
    if (palette.value?.path === currentPath) palette.value = null
  }
  watch([() => route.path, theme], ([path, value]) => {
    if (!import.meta.client) return
    if (!value) { clear(); return }
    currentPath = path
    palette.value = { path, theme: value }
  }, { immediate: true, flush: 'post' })
  onBeforeUnmount(clear)
}

/**
 * Extracts a palette for an artist from their artwork or banner.
 * Downscales through the same-origin proxy to a 16×16 canvas and passes the pixels to artistTheme.
 * Starts with NEUTRAL_ARTIST_THEME and caches results keyed by cacheKey.
 */
export function useArtistTheme(
  src: () => string | null | undefined,
  cacheKey?: () => string | undefined
): Ref<ArtistTheme> {
  const key = computed(() => cacheKey?.())
  const theme = ref<ArtistTheme>(NEUTRAL_ARTIST_THEME)
  let generation = 0
  let previousKey: string | undefined

  async function update() {
    const own = ++generation
    const currentKey = key.value
    const source = src()
    const cached = currentKey ? cache.get(currentKey) : undefined
    if (currentKey !== previousKey || !source) theme.value = cached?.theme || NEUTRAL_ARTIST_THEME
    previousKey = currentKey
    if (cached && cached.source === source) {
      theme.value = cached.theme
      return
    }
    if (!source || !import.meta.client) return

    try {
      const image = await loadArtwork(source, 128)
      if (own !== generation) return
      const size = ARTIST_THEME_SAMPLE
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(image, 0, 0, size, size)
      const data = ctx.getImageData(0, 0, size, size).data
      const computedTheme = artistTheme(data, 4)
      if (own !== generation) return
      theme.value = computedTheme
      if (currentKey) {
        rememberArtistTheme(currentKey, source, computedTheme)
      }
    } catch {
      if (own === generation && (!currentKey || !knownArtistTheme(currentKey))) {
        theme.value = { ...NEUTRAL_ARTIST_THEME }
      }
    }
  }

  watch([() => src(), key], () => { void update() }, { immediate: true })
  onBeforeUnmount(() => { generation++ })

  return theme
}
