import type { Ref } from 'vue'
import type { AlbumPresentation, AlbumPresentationColors, AlbumPresentationRequest, OfflineAlbumPresentation } from '../../shared/types/music'
import { albumDominant, albumTint } from '../../shared/utils/album-tint'
import { loadArtwork, useLocalArtwork } from './useArtwork'
import { useMotionAllowed } from './useMotionArt'

export interface AlbumPresentationIdentity {
  source: 'local' | 'youtube'
  trackId?: string
  albumId?: string
  artists?: string[]
  album?: string
  artwork?: string | null
  key?: string
}

export interface AlbumTintColors {
  background: string
  surface: string
  muted: string
  edge: string
}

interface CacheEntry {
  presentation: AlbumPresentation
  dominant?: string | null
  tint: AlbumTintColors
  motionRequested?: boolean
  isFinal?: boolean
  retryAt?: number
}

export const albumDescriptionDialogOpen = ref(false)

const memoryCache = new Map<string, CacheEntry>()
const failedMotions = new Set<string>()

export function getCachedPresentation(albumIdOrKey: string): OfflineAlbumPresentation | undefined {
  const clean = albumIdOrKey.replace(/^(album:|youtube:|local:)/, '')
  const entry = memoryCache.get(albumIdOrKey)
    || memoryCache.get(`album:${clean}`)
    || memoryCache.get(`youtube:${clean}`)
    || memoryCache.get(`local:${clean}`)
  if (!entry) return undefined
  return {
    description: entry.presentation.description,
    colors: entry.presentation.colors,
    dominant: entry.dominant,
  }
}

function canonicalKey(ident: AlbumPresentationIdentity): string {
  if (ident.key) return ident.key
  if (ident.source === 'local') return `local:${ident.trackId || ''}`
  return `youtube:${ident.albumId || `${ident.artists?.[0] || ''}:${ident.album || ''}`}`
}

function collectionKey(ident: AlbumPresentationIdentity): string {
  if (ident.source === 'local') {
    const raw = ident.key?.replace(/^local:/, '') || ident.trackId || ''
    return `album:${raw}`
  }
  const raw = ident.albumId || ident.key?.replace(/^youtube:/, '') || `${ident.artists?.[0] || ''}:${ident.album || ''}`
  return `album:${raw}`
}

async function extractDominantColor(artworkSrc: string): Promise<string | null> {
  if (!import.meta.client || !artworkSrc) return null
  try {
    const img = await loadArtwork(artworkSrc, 128)
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height
    const cropSize = Math.min(width, height)
    const sx = Math.max(0, (width - cropSize) / 2)
    const sy = Math.max(0, (height - cropSize) / 2)
    ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, size, size)
    const pixels = ctx.getImageData(0, 0, size, size).data
    return albumDominant(pixels, size, size, 4)
  } catch {
    return null
  }
}

export function useAlbumPresentation(
  identity: () => AlbumPresentationIdentity | null | undefined,
  artwork?: () => string | null | undefined
): {
  tint: Ref<AlbumTintColors>
  description: Ref<{ text: string; source: 'apple' | 'youtube' } | undefined>
  motionUrl: Ref<string | undefined>
  motionFailed: () => void
} {
  const downloads = useDownloadsStore()
  const motionAllowed = useMotionAllowed()
  const localCover = useLocalArtwork(() => {
    const id = identity()
    return id?.artwork || artwork?.()
  })

  const tint = ref<AlbumTintColors>(albumTint(null))
  const description = ref<{ text: string; source: 'apple' | 'youtube' } | undefined>()
  const motionUrl = ref<string | undefined>()

  let readyMotionUrl: string | undefined
  const coverVisible = ref(false)
  let coverObserver: IntersectionObserver | undefined
  let observedCoverEl: Element | undefined

  let generation = 0
  let controller: AbortController | undefined
  let pendingTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  /** Only the album page's own header cover counts; the mini player and the expanded player also render covers. */
  function headerCover(): Element | null {
    return document.querySelector('.album-page :is(.collection-header, .catalog-album-hero, .collection-heading) > .album-cover')
      || document.querySelector('.album-page :is(.collection-header, .catalog-album-hero, .collection-heading) .album-cover')
  }

  function checkCoverElementVisible(): boolean {
    if (!import.meta.client) return false
    const el = headerCover()
    if (!el) return window.scrollY < 200
    const rect = el.getBoundingClientRect()
    return (
      rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
      rect.bottom > 0 &&
      rect.left < (window.innerWidth || document.documentElement.clientWidth) &&
      rect.right > 0
    )
  }

  function setupCoverObserver() {
    if (!import.meta.client || !('IntersectionObserver' in window)) {
      coverVisible.value = true
      return
    }
    const el = headerCover()
    if (!el) {
      coverVisible.value = window.scrollY < 200
      return
    }
    if (observedCoverEl === el) return
    observedCoverEl = el
    coverObserver?.disconnect()
    coverObserver = new IntersectionObserver(([entry]) => {
      coverVisible.value = !!entry?.isIntersecting
      syncMotionUrl()
    }, { threshold: 0.05 })
    coverObserver.observe(el)
    coverVisible.value = checkCoverElementVisible()
  }

  function syncMotionUrl() {
    if (motionAllowed.value && coverVisible.value && readyMotionUrl) {
      motionUrl.value = readyMotionUrl
    } else {
      motionUrl.value = undefined
    }
  }

  function applyPresentation(
    pres: AlbumPresentation,
    dominant: string | null | undefined
  ) {
    description.value = pres.description
    if (pres.colors?.background) {
      tint.value = albumTint(pres.colors.background)
    } else if (dominant) {
      tint.value = albumTint(dominant)
    } else {
      tint.value = albumTint(null)
    }

    if (pres.motion?.status === 'ready' && !failedMotions.has(pres.motion.url)) {
      readyMotionUrl = pres.motion.url
    } else {
      readyMotionUrl = undefined
    }

    syncMotionUrl()
  }

  async function update() {
    const own = ++generation
    clearTimeout(pendingTimer)
    pendingTimer = undefined
    clearTimeout(retryTimer)
    retryTimer = undefined
    controller?.abort()
    controller = undefined

    const ident = identity()
    if (!ident) {
      tint.value = albumTint(null)
      description.value = undefined
      readyMotionUrl = undefined
      motionUrl.value = undefined
      return
    }

    const key = canonicalKey(ident)
    const cKey = collectionKey(ident)

    if (import.meta.client) {
      await nextTick()
      setupCoverObserver()
      coverVisible.value = checkCoverElementVisible()
    }

    const shouldRequestMotion = motionAllowed.value && coverVisible.value

    // 1. Check in-memory cache
    const cached = memoryCache.get(key) || memoryCache.get(cKey)
    if (cached) {
      applyPresentation(cached.presentation, cached.dominant)
      const isRetryDue = !!(cached.retryAt && Date.now() >= cached.retryAt)
      const needsMotionUpgrade = shouldRequestMotion && !cached.motionRequested
      if (cached.isFinal && !needsMotionUpgrade && !isRetryDue) {
        return
      }
      if (!isRetryDue && !needsMotionUpgrade && cached.retryAt) {
        return
      }
    }

    // 2. Check offline collection record
    const offlineRec = downloads.collections[cKey]?.presentation
    if (offlineRec && !cached) {
      description.value = offlineRec.description
      if (offlineRec.colors?.background) {
        tint.value = albumTint(offlineRec.colors.background)
      } else if (offlineRec.dominant) {
        tint.value = albumTint(offlineRec.dominant)
      } else {
        tint.value = albumTint(null)
      }
    } else if (!cached) {
      tint.value = albumTint(null)
      description.value = undefined
    }
    if (!cached) {
      readyMotionUrl = undefined
      motionUrl.value = undefined
    }

    let dominantColor: string | null = cached?.dominant ?? offlineRec?.dominant ?? null
    let fetchFinished = false
    let timerElapsed = false

    // Offline / saved cover computation (Item 1 & 6)
    const displayedArtwork = localCover.value || ident.artwork || artwork?.()
    if (displayedArtwork) {
      void extractDominantColor(displayedArtwork).then(dom => {
        if (own !== generation || !dom) return
        dominantColor = dom
        if (!fetchFinished) {
          if (timerElapsed && !offlineRec?.colors?.background && !cached?.presentation.colors?.background) {
            tint.value = albumTint(dom)
          }
          return
        }
        const entry = memoryCache.get(key)
        if (entry && !entry.presentation.colors?.background) {
          entry.dominant = dom
          entry.tint = albumTint(dom)
          tint.value = entry.tint
          if (downloads.collections[cKey]) {
            void downloads.savePresentation(cKey, {
              description: entry.presentation.description,
              colors: entry.presentation.colors,
              dominant: dom,
            })
          }
        } else if (!entry && !offlineRec?.colors?.background) {
          tint.value = albumTint(dom)
        }
      })
    }

    // 800 ms pending fallback timer
    pendingTimer = setTimeout(() => {
      timerElapsed = true
      if (own !== generation || fetchFinished) return
      if (dominantColor && !offlineRec?.colors?.background && !cached?.presentation.colors?.background) {
        tint.value = albumTint(dominantColor)
      }
    }, 800)

    const requestBody: AlbumPresentationRequest = ident.source === 'local'
      ? { source: 'local', trackId: ident.trackId || '', motion: shouldRequestMotion }
      : {
          source: 'youtube',
          albumId: ident.albumId,
          artists: ident.artists || [],
          album: ident.album || '',
          motion: shouldRequestMotion,
        }

    controller = new AbortController()

    try {
      const response = await $fetch.raw<AlbumPresentation>('/api/albums/presentation', {
        method: 'POST',
        body: requestBody,
        retry: 0,
        signal: controller.signal,
      })

      fetchFinished = true
      clearTimeout(pendingTimer)

      if (own !== generation) return

      const result = response._data!

      // Item 3: Check Retry-After and motion.retryAfterMs
      let retryDelayMs: number | undefined
      if (result.motion && 'retryAfterMs' in result.motion && typeof result.motion.retryAfterMs === 'number') {
        retryDelayMs = result.motion.retryAfterMs
      }
      const retryHeader = response.headers.get('retry-after')
      if (retryHeader) {
        const parsed = parseInt(retryHeader, 10)
        if (!Number.isNaN(parsed)) {
          retryDelayMs = Math.max(retryDelayMs || 0, parsed * 1000)
        }
      }

      // Keep previous valid Apple fields (do not overwrite with missing ones)
      const prevDesc = cached?.presentation.description || offlineRec?.description
      const prevColors = cached?.presentation.colors || offlineRec?.colors
      const finalDescription = result.description || prevDesc
      const finalColors = result.colors || prevColors

      const mergedPresentation: AlbumPresentation = {
        ...result,
        description: finalDescription,
        colors: finalColors,
      }

      applyPresentation(mergedPresentation, dominantColor)

      const retryAt = typeof retryDelayMs === 'number' && retryDelayMs > 0
        ? Date.now() + Math.max(1000, retryDelayMs)
        : undefined
      const isPartial = retryAt !== undefined
      const isFinal = !isPartial

      const cacheEntry: CacheEntry = {
        presentation: mergedPresentation,
        dominant: dominantColor,
        tint: tint.value,
        motionRequested: shouldRequestMotion,
        isFinal,
        retryAt,
      }
      memoryCache.set(key, cacheEntry)
      memoryCache.set(cKey, cacheEntry)

      if (typeof retryDelayMs === 'number' && retryDelayMs > 0) {
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => {
          if (own === generation) void update()
        }, Math.max(1000, retryDelayMs))
      }

      if (downloads.collections[cKey]) {
        void downloads.savePresentation(cKey, {
          description: mergedPresentation.description,
          colors: mergedPresentation.colors,
          dominant: dominantColor,
        })
      }
    } catch (error) {
      fetchFinished = true
      clearTimeout(pendingTimer)

      if (controller?.signal.aborted || own !== generation) return

      const failure = error as { data?: { retryAfterMs?: number; data?: { retryAfterMs?: number } } }
      const retryMs = failure?.data?.retryAfterMs || failure?.data?.data?.retryAfterMs
      if (retryMs) {
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => {
          if (own === generation) void update()
        }, Math.max(1000, retryMs))
      }

      if (offlineRec?.colors?.background) {
        tint.value = albumTint(offlineRec.colors.background)
      } else if (dominantColor) {
        tint.value = albumTint(dominantColor)
      } else if (offlineRec?.dominant) {
        tint.value = albumTint(offlineRec.dominant)
      } else {
        tint.value = albumTint(null)
      }
      if (offlineRec?.description) {
        description.value = offlineRec.description
      }
    }
  }

  function motionFailed() {
    if (readyMotionUrl) {
      failedMotions.add(readyMotionUrl)
    }
    readyMotionUrl = undefined
    motionUrl.value = undefined
  }

  watch(
    () => {
      const id = identity()
      return id ? canonicalKey(id) : undefined
    },
    () => { void update() },
    { immediate: true }
  )

  watch(coverVisible, (visible) => {
    syncMotionUrl()
    if (visible && motionAllowed.value) {
      const ident = identity()
      if (ident) {
        const cached = memoryCache.get(canonicalKey(ident)) || memoryCache.get(collectionKey(ident))
        if (cached && !cached.motionRequested) {
          void update()
        }
      }
    }
  })

  watch(motionAllowed, (allowed) => {
    syncMotionUrl()
    if (allowed && coverVisible.value) {
      const ident = identity()
      if (ident) {
        const cached = memoryCache.get(canonicalKey(ident)) || memoryCache.get(collectionKey(ident))
        if (cached && !cached.motionRequested) {
          void update()
        }
      }
    }
  })

  watch(localCover, (newCover) => {
    if (!newCover) return
    void extractDominantColor(newCover).then(dom => {
      if (!dom) return
      const ident = identity()
      if (!ident) return
      const key = canonicalKey(ident)
      const cKey = collectionKey(ident)
      const entry = memoryCache.get(key) || memoryCache.get(cKey)
      if (entry && !entry.presentation.colors?.background) {
        entry.dominant = dom
        entry.tint = albumTint(dom)
        tint.value = entry.tint
        if (downloads.collections[cKey]) {
          void downloads.savePresentation(cKey, {
            description: entry.presentation.description,
            colors: entry.presentation.colors,
            dominant: dom,
          })
        }
      }
    })
  })

  onBeforeUnmount(() => {
    generation++
    controller?.abort()
    clearTimeout(pendingTimer)
    clearTimeout(retryTimer)
    coverObserver?.disconnect()
  })

  return {
    tint,
    description,
    motionUrl,
    motionFailed,
  }
}
