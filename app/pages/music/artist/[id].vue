<script setup lang="ts">
import type { ListeningContext } from '../../../../shared/types/telemetry'
import { Info } from '@lucide/vue'
import type { YouTubeAlbum, YouTubeArtistProfile, YouTubeSong } from '../../../../shared/types/music'
import { useArtistTheme } from '../../../composables/useArtistTheme'
import { useArtistMotion } from '../../../composables/useArtistMotion'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { disconnected } = useMusicConnection()
const library = useLibraryStore()
const player = usePlayerStore()
const biographyOpen = ref(false)
watch(id, () => { biographyOpen.value = false })
const { data: artist, status, error, refresh } = await useFetch<YouTubeArtistProfile>(() => `/api/music/artists/${encodeURIComponent(id.value)}`, { lazy: true, timeout: 20000, retry: 0 })
const loadError = computed(() => (error.value?.data as { message?: string } | undefined)?.message || 'No se pudo consultar este artista.')
useStartupContent(() => disconnected.value || status.value === 'success' || status.value === 'error')
const songs = useMusicCollection<YouTubeSong>(() => `/api/music/artists/${encodeURIComponent(id.value)}/songs`, 'songs')
const albums = useMusicCollection<YouTubeAlbum>(() => `/api/music/artists/${encodeURIComponent(id.value)}/releases`, 'albums', { kind: 'albums' })
const singles = useMusicCollection<YouTubeAlbum>(() => `/api/music/artists/${encodeURIComponent(id.value)}/releases`, 'albums', { kind: 'singles' })
const visibleSongs = computed(() => songs.started ? songs.items : artist.value?.topSongs || [])
const releases = computed(() => [
  { kind: 'albums' as const, title: 'Álbumes', collection: albums, preview: artist.value?.albums || [] },
  { kind: 'singles' as const, title: 'Singles y EPs', collection: singles, preview: artist.value?.singles || [] },
])
/** Newest release across both shelves; provider order breaks ties. */
const latest = computed(() => {
  const all = [...(artist.value?.albums || []).map(album => ({ album, kind: 'Álbum' })), ...(artist.value?.singles || []).map(album => ({ album, kind: 'Single / EP' }))]
  return all.reduce<typeof all[number] | null>((best, item) => !best || (item.album.year || 0) > (best.album.year || 0) ? item : best, null)
})
const similar = computed(() => artist.value?.similar || [])
const listeningContext = computed<ListeningContext | undefined>(() => artist.value ? { kind: 'artist', id: 'youtube:' + id.value, title: artist.value.name, subtitle: 'Artista', artwork: artist.value.artwork } : undefined)
function shuffle() {
  const list = visibleSongs.value
  if (!list.length) return
  player.playYouTube(list, Math.floor(Math.random() * list.length), listeningContext.value)
  player.toggleShuffle()
}
watch(disconnected, value => { if (!value && (!artist.value || error.value)) void refresh() })
useHead({ title: () => artist.value ? `${artist.value.name} · Openfy` : 'Artista · Openfy' })

/* Artist identity: theme and header motion video */
const loadedBanner = ref<string | null>()
const hasBanner = computed(() => !!artist.value?.banner && loadedBanner.value === artist.value.banner)
const themeSource = computed(() => hasBanner.value ? artist.value?.banner : artist.value?.artwork)
const theme = useArtistTheme(() => themeSource.value, () => 'youtube:' + id.value)
useArtistShellTheme(() => route.path.startsWith('/music/artist/') ? theme.value : undefined)
// useArtistTheme remembers only sampled themes under this key, so the search result can reuse them.

const motionAlbumTitles = computed(() => {
  const list = [...(artist.value?.albums || []), ...(artist.value?.singles || [])]
  return list.map(item => item.title).filter(Boolean)
})

const { url: motionUrl, failed: motionFailed } = useArtistMotion(
  () => artist.value?.id ? id.value : undefined,
  () => artist.value?.name,
  () => motionAlbumTitles.value
)

const videoRef = ref<HTMLVideoElement>()
const videoPlaying = ref(false)
watch(motionUrl, () => { videoPlaying.value = false })

function onVideoError() {
  motionFailed()
  videoPlaying.value = false
}

/** One condition for the header video: page visible and header on screen. */
const heroVisible = ref(true)
function syncVideo() {
  const video = videoRef.value
  if (!video) return
  if (!document.hidden && heroVisible.value && motionUrl.value && !biographyOpen.value) void video.play().catch(() => {})
  else video.pause()
}
function onVisibilityChange() { syncVideo() }
watch(videoRef, () => syncVideo(), { flush: 'post' })
watch(biographyOpen, syncVideo)

/* Dynamic gradient stop anchoring and DetailBar tint following scroll */
const heroRef = ref<HTMLElement>()
const stageRef = ref<HTMLElement>()
const overviewRef = ref<HTMLElement>()
const releasesWrapRef = ref<HTMLElement>()
const aboutRef = ref<HTMLElement>()
const similarRef = ref<HTMLElement>()

const stopPopular = ref('450px')
const stopReleases = ref('900px')
const stopAbout = ref('1400px')
const stopEnd = ref('1800px')

const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const barTint = ref<string>('')
const heroBackdropOffset = ref('0px')
const pinnedBar = ref(false)
const detailBarTint = computed(() => (hasBanner.value || videoPlaying.value) && !pinnedBar.value ? '' : barTint.value)

function parseHex(c: string): [number, number, number] {
  const hex = (c || '#18181b').replace('#', '')
  if (hex.length === 3) {
    return [
      parseInt(hex[0]! + hex[0]!, 16),
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
    ]
  }
  return [
    parseInt(hex.slice(0, 2), 16) || 0,
    parseInt(hex.slice(2, 4), 16) || 0,
    parseInt(hex.slice(4, 6), 16) || 0,
  ]
}

function interpolateHex(c1: string, c2: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const [r1, g1, b1] = parseHex(c1)
  const [r2, g2, b2] = parseHex(c2)
  const r = Math.round(r1 + (r2 - r1) * clamped)
  const g = Math.round(g1 + (g2 - g1) * clamped)
  const b = Math.round(b1 + (b2 - b1) * clamped)
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('')
}

/** The wash is painted on the whole content panel (.main-column), so the top bar takes the section colour as well. */
let column: HTMLElement | null = null
function paintColumn() {
  if (!import.meta.client) return
  column ??= document.querySelector<HTMLElement>('.main-column')
  if (!column) return
  column.classList.add('artist-tinted')
  const values: Record<string, string> = {
    '--artist-base': theme.value.base, '--artist-secondary': theme.value.secondary, '--artist-deep': theme.value.deep,
    '--artist-stop-popular': stopPopular.value, '--artist-stop-releases': stopReleases.value, '--artist-stop-about': stopAbout.value, '--artist-stop-end': stopEnd.value,
  }
  for (const [name, value] of Object.entries(values)) column.style.setProperty(name, value)
}
function releaseColumn() {
  if (!column) return
  column.classList.remove('artist-tinted')
  for (const name of ['--artist-base', '--artist-secondary', '--artist-deep', '--artist-stop-popular', '--artist-stop-releases', '--artist-stop-about', '--artist-stop-end']) column.style.removeProperty(name)
  column = null
}

function updateStops() {
  if (!import.meta.client) return
  column ??= document.querySelector<HTMLElement>('.main-column')
  const origin = (column || document.querySelector('.artist-page'))?.getBoundingClientRect().top
  if (origin === undefined) return
  if (stageRef.value) heroBackdropOffset.value = `${Math.max(0, Math.round(stageRef.value.getBoundingClientRect().top - origin))}px`
  const bottom = (element: HTMLElement) => `${Math.round(element.getBoundingClientRect().bottom - origin)}px`
  if (overviewRef.value) stopPopular.value = bottom(overviewRef.value)
  if (releasesWrapRef.value) stopReleases.value = bottom(releasesWrapRef.value)
  const finalSection = similarRef.value || aboutRef.value || releasesWrapRef.value || overviewRef.value
  if (finalSection) {
    stopAbout.value = bottom(finalSection)
    stopEnd.value = `${Math.round(finalSection.getBoundingClientRect().bottom - origin + 160)}px`
  }
  paintColumn()
}

function updateTint() {
  if (!import.meta.client) return
  const baseColor = theme.value.base
  const secondaryColor = theme.value.secondary
  const deepColor = theme.value.deep
  const appBg = '#09090b'
  const barY = 60
  pinnedBar.value = (stageRef.value?.getBoundingClientRect().bottom ?? Infinity) < barY + 60

  if (reducedMotion.value) {
    if (aboutRef.value && aboutRef.value.getBoundingClientRect().top <= barY) {
      barTint.value = deepColor
    } else if (similarRef.value && similarRef.value.getBoundingClientRect().top <= barY) {
      barTint.value = deepColor
    } else if (releasesWrapRef.value && releasesWrapRef.value.getBoundingClientRect().top <= barY) {
      barTint.value = secondaryColor
    } else {
      barTint.value = baseColor
    }
    return
  }

  const transitionWindow = 120
  const releasesTop = releasesWrapRef.value ? releasesWrapRef.value.getBoundingClientRect().top : Infinity
  const deepSec = aboutRef.value || similarRef.value
  const aboutTop = deepSec ? deepSec.getBoundingClientRect().top : Infinity

  if (aboutTop <= barY) {
    const progress = (barY - aboutTop) / transitionWindow
    if (progress < 1) {
      barTint.value = interpolateHex(secondaryColor, deepColor, progress)
    } else {
      const deepBottom = (similarRef.value || deepSec)?.getBoundingClientRect().bottom ?? Infinity
      if (deepBottom <= barY) {
        const endProgress = (barY - deepBottom) / 200
        barTint.value = interpolateHex(deepColor, appBg, endProgress)
      } else {
        barTint.value = deepColor
      }
    }
  } else if (releasesTop <= barY) {
    const progress = (barY - releasesTop) / transitionWindow
    barTint.value = interpolateHex(baseColor, secondaryColor, progress)
  } else {
    barTint.value = baseColor
  }
}

let rafId: number | undefined
function onScroll() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    updateTint()
  })
}

let heroObserver: IntersectionObserver | undefined
let resizeObserver: ResizeObserver | undefined

/** The sections render only once the profile has loaded, so observers follow the elements instead of the mount. */
watch(() => [heroRef.value, overviewRef.value, releasesWrapRef.value, aboutRef.value, similarRef.value] as const, elements => {
  if (!import.meta.client) return
  heroObserver?.disconnect(); resizeObserver?.disconnect()
  const [hero] = elements
  if (hero) {
    heroObserver ??= new IntersectionObserver(([entry]) => {
      // Remembered even before the video exists, so a late video never autoplays off screen.
      heroVisible.value = !!entry?.isIntersecting
      syncVideo()
    })
    heroObserver.observe(hero)
  }
  resizeObserver ??= new ResizeObserver(() => { updateStops(); updateTint() })
  for (const element of elements) if (element) resizeObserver.observe(element)
  const topbar = column?.querySelector('.topbar')
  if (topbar) resizeObserver.observe(topbar)
  void nextTick(() => { updateStops(); updateTint() })
}, { flush: 'post' })
watch(theme, () => { updateTint(); paintColumn() })

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  releaseColumn()
  heroObserver?.disconnect()
  resizeObserver?.disconnect()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('scroll', onScroll)
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<template>
  <div
    class="page-content catalog-page artist-page"
    :style="{
      '--artist-base': theme.base,
      '--artist-secondary': theme.secondary,
      '--artist-deep': theme.deep,
      '--artist-surface': theme.surface,
      '--artist-stop-popular': stopPopular,
      '--artist-stop-releases': stopReleases,
      '--artist-stop-about': stopAbout,
      '--artist-stop-end': stopEnd,
      '--artist-cover-offset': heroBackdropOffset,
    }"
  >
    <DetailBar :title="artist?.name" fallback="/search" :tint="detailBarTint" />
    <div v-if="disconnected" class="empty-state" role="status"><OIcon name="offline" :size="44" /><h1>Conecta para explorar este artista.</h1><p>Necesitas conexión con tu PC e Internet.</p><button class="button subtle" @click="library.refresh">Reintentar conexión</button></div>
    <div v-else-if="status === 'pending' || status === 'idle'" class="empty-state" role="status"><OIcon name="loading" class="spin" :size="36" /><p>Cargando artista…</p></div>
    <div v-else-if="error || !artist" class="empty-state" role="status"><h1>Artista no disponible.</h1><p>{{ loadError }}</p><button class="button primary" @click="refresh()">Reintentar artista</button></div>
    <template v-else>
      <header
        ref="heroRef"
        class="catalog-artist-hero"
        :class="{ 'has-media': hasBanner || videoPlaying, 'has-portrait': !hasBanner && !videoPlaying }"
      >
        <div ref="stageRef" class="artist-stage">
          <div v-if="artist.banner || motionUrl" class="artist-backdrop" aria-hidden="true" :class="{ 'has-artwork': hasBanner }">
            <AlbumCover v-if="artist.banner" :key="artist.banner" :src="artist.banner" :size="2048" @load="loadedBanner = artist.banner" />
            <video
              v-if="motionUrl"
              ref="videoRef"
              :src="motionUrl"
              muted
              loop
              playsinline
              class="artist-header-video"
              :class="{ 'is-playing': videoPlaying }"
              @playing="videoPlaying = true"
              @loadeddata="syncVideo"
              @error="onVideoError"
            />
          </div>
          <AlbumCover v-if="!hasBanner" class="artist-portrait" :src="artist.artwork" :title="artist.name" :size="512" />
          <div class="artist-stage-content">
            <div class="catalog-artist-copy">
              <p class="artist-kind">Artista</p>
              <h1>{{ artist.name }}</h1>
            </div>
            <div class="artist-actions">
              <button class="artist-play" :disabled="!visibleSongs.length" @click="player.playYouTube(visibleSongs, 0, listeningContext)"><OIcon name="play" :size="22" /><span>Reproducir</span></button>
              <button class="button subtle" :disabled="visibleSongs.length < 2" @click="shuffle"><OIcon name="shuffle" :size="18" />Aleatorio</button>
              <button v-if="artist.description" class="artist-info-button" :aria-label="`Acerca de ${artist.name}`" aria-haspopup="dialog" @click="biographyOpen = true"><Info :size="20" aria-hidden="true" /></button>
            </div>
          </div>
        </div>
      </header>

      <div ref="overviewRef" class="artist-overview" :class="{ 'with-latest': latest }">
        <section class="catalog-section artist-popular" aria-labelledby="artist-songs-title">
          <div class="section-heading"><h2 id="artist-songs-title">{{ songs.started ? 'Canciones' : 'Canciones populares' }}</h2><button v-if="!songs.started && artist.expandable.songs" class="catalog-text-button" :disabled="songs.busy" @click="songs.load()">Ver todas las canciones</button></div>
          <YouTubeTrackList v-if="visibleSongs.length" :songs="visibleSongs" :label="`Canciones de ${artist.name}`" />
          <p v-else class="muted catalog-empty">Este artista todavía no tiene canciones disponibles.</p>
          <div v-if="songs.busy || songs.error || (songs.started && songs.cursor)" class="catalog-more"><p v-if="songs.error" role="status">{{ songs.error }}</p><p v-if="songs.busy" role="status">Cargando canciones…</p><button v-else class="button subtle" @click="songs.load(songs.expired)">{{ songs.error ? songs.expired ? 'Actualizar canciones' : 'Reintentar canciones' : 'Cargar más canciones' }}</button></div>
        </section>
        <aside v-if="latest" class="catalog-section artist-latest" aria-labelledby="artist-latest-title">
          <div class="section-heading"><h2 id="artist-latest-title">Último lanzamiento</h2></div>
          <NuxtLink :to="`/music/album/${latest.album.id}`" class="artist-latest-card">
            <AlbumCover :src="latest.album.artwork" :title="latest.album.title" :size="1024" />
            <strong :title="latest.album.title">{{ latest.album.title }}</strong>
            <span>{{ [latest.album.year, latest.kind].filter(Boolean).join(' · ') }}</span>
          </NuxtLink>
        </aside>
      </div>

      <div ref="releasesWrapRef" class="artist-releases">
        <section v-for="release in releases" :key="release.kind" class="catalog-section" :aria-labelledby="`artist-${release.kind}-title`">
          <div class="section-heading"><h2 :id="`artist-${release.kind}-title`">{{ release.title }}</h2></div>
          <MusicReleaseGrid :albums="release.collection.started ? release.collection.items : release.preview" />
          <p v-if="!(release.collection.started ? release.collection.items : release.preview).length" class="muted catalog-empty">No hay {{ release.title.toLocaleLowerCase('es') }} disponibles.</p>
          <div v-if="release.collection.busy || release.collection.error || (release.collection.started ? release.collection.cursor : artist.expandable[release.kind])" class="catalog-more"><p v-if="release.collection.error" role="status">{{ release.collection.error }}</p><p v-if="release.collection.busy" role="status">Cargando {{ release.title.toLocaleLowerCase('es') }}…</p><button v-else class="button subtle" @click="release.collection.load(release.collection.expired)">{{ release.collection.error ? release.collection.expired ? `Actualizar ${release.title.toLocaleLowerCase('es')}` : `Reintentar ${release.title.toLocaleLowerCase('es')}` : `Ver más ${release.title.toLocaleLowerCase('es')}` }}</button></div>
        </section>
      </div>

      <section v-if="artist.description" ref="aboutRef" class="catalog-section" aria-labelledby="artist-about-title">
        <div class="section-heading"><h2 id="artist-about-title">Acerca de</h2></div>
        <div class="artist-about">
          <div class="artist-about-art" aria-hidden="true"><AlbumCover :src="artist.banner || artist.artwork" :size="1024" /></div>
          <p class="catalog-biography">{{ artist.description }}</p>
          <button class="catalog-text-button biography-toggle" aria-haspopup="dialog" @click="biographyOpen = true">Leer biografía</button>
        </div>
      </section>

      <section v-if="similar.length" ref="similarRef" class="catalog-section" aria-labelledby="artist-similar-title">
        <div class="section-heading"><h2 id="artist-similar-title">Fans también escuchan</h2></div>
        <div class="album-grid artist-similar-grid"><NuxtLink v-for="item in similar" :key="item.id" :to="`/music/artist/${item.id}`" class="album-card artist-card"><AlbumCover :src="item.artwork" :title="item.name" /><strong :title="item.name">{{ item.name }}</strong><span>Artista</span></NuxtLink></div>
      </section>
      <ArtistBiography v-if="artist.description" :open="biographyOpen" :name="artist.name" :description="artist.description" :artwork="artist.artwork || artist.banner" :theme="theme" @close="biographyOpen = false" />
    </template>
  </div>
</template>
