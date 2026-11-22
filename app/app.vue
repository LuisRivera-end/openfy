<script setup lang="ts">
import { songCount } from '../shared/utils/text'
import { reconnectDelay } from '../shared/utils/startup'
import type { PageChromeColors } from './composables/usePageChrome'
import './assets/artist-chrome.css'
import './assets/page-chrome.css'
useAppearanceStore()
const library = useLibraryStore()
const downloads = useDownloadsStore()
const player = usePlayerStore()
const lyrics = useLyricsStore()
watch(() => library.connected, (connected) => { if (connected) void lyrics.backfill().catch(() => {}) })
const route = useRoute()
const artistPalette = useArtistShellPalette()
const artistChrome = computed(() => artistPalette.value?.path === route.path ? artistPalette.value.theme : undefined)
const artistChromeStyle = computed(() => artistChrome.value && {
  '--artist-base': artistChrome.value.base,
  '--artist-secondary': artistChrome.value.secondary,
  '--artist-deep': artistChrome.value.deep,
})
/** The frame takes the colour of the album or artist on screen: sidebar, top bar, player and tab bar (page-chrome.css). */
const pageChromeState = usePageChromeState()
const pageChrome = computed<PageChromeColors | undefined>(() => {
  if (pageChromeState.value?.path === route.path) return pageChromeState.value.colors
  const theme = artistChrome.value
  return theme && { background: theme.base, surface: theme.surface, muted: '#EDEDF0', edge: theme.deep }
})
watch(pageChrome, colors => {
  if (!import.meta.client) return
  const root = document.documentElement
  root.classList.toggle('page-chrome', !!colors)
  for (const key of ['background', 'surface', 'muted', 'edge'] as const) {
    if (colors) root.style.setProperty(`--chrome-${key}`, colors[key])
    else root.style.removeProperty(`--chrome-${key}`)
  }
}, { immediate: true })
const importOpen = useState('importOpen', () => false)
const playlistOpen = useState('playlistOpen', () => false)
const playlistName = ref('')
const fileInput = ref<HTMLInputElement>()
const folderInput = ref<HTMLInputElement>()
const startup = useStartupStore()
const ready = computed(() => startup.coreReady)
const hidden = ref(false)
const updates = useUpdatesStore()
const releaseNotes = useReleaseNotesStore()
const nav = [{ to: '/', icon: 'home', label: 'Inicio' }, { to: '/search', icon: 'search', label: 'Buscar' }, { to: '/library', icon: 'library', label: 'Tu biblioteca' }]
const currentNav = (path: string) => route.path === path || (path === '/search' && route.path.startsWith('/music/'))
/** Phone tabs behave like iOS navigation stacks: a detail page keeps the tab it was opened from. */
const tabRoots = ['/', '/search', '/library', '/downloads']
const tabFor = (path: string) => tabRoots.includes(path) ? path : path.startsWith('/music/') ? '/search'
  : ['/album/', '/artist/', '/playlist/'].some(prefix => path.startsWith(prefix)) || ['/favorites', '/most-played'].includes(path) ? '/library' : '/'
const activeTab = ref(tabFor(route.path))
watch(() => route.path, path => { if (tabRoots.includes(path)) activeTab.value = path })
/** Tapping the tab you are already on scrolls back to the top. */
function tabClick(to: string) {
  if (to === '/search') document.getElementById('global-search')?.focus({ preventScroll: true })
  if (route.path === to) window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'instant' : 'smooth' })
}
const coarsePointer = useMediaQuery('(pointer: coarse)')
const phone = usePhone()
/** iOS 26/27 tab bar: scrolling down shrinks it to the current tab and docks the mini player beside it; scrolling up restores it. */
const compactDock = ref(false)
let lastScroll = 0, scrollFrame = 0
function trackScroll() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    const y = window.scrollY, delta = y - lastScroll
    if (y < 80) { compactDock.value = false; lastScroll = y }
    else if (Math.abs(delta) > 8) { compactDock.value = delta > 0; lastScroll = y }
  })
}
watch(() => route.path, () => { compactDock.value = false; lastScroll = 0 })
/** A tap on the shrunken tab bar restores it instead of navigating. */
function expandDock(event: Event) { if (!compactDock.value) return; event.preventDefault(); event.stopPropagation(); compactDock.value = false }
let polling: ReturnType<typeof setInterval> | undefined
let lastPoll = 0, reconnectAttempt = 0
let refreshing = false
function visibility() { hidden.value = document.hidden; document.documentElement.classList.toggle('motion-paused', hidden.value); if (!hidden.value) void library.refresh().then(() => useTelemetryStore().refresh()) }
async function selectFiles(event: Event) {
  const target = event.target as HTMLInputElement
  importOpen.value = false
  if (target.files?.length) await library.importFiles(target.files)
  target.value = ''
}
async function createPlaylist() {
  const playlist = await library.createPlaylist(playlistName.value.trim())
  if (playlist) { playlistOpen.value = false; playlistName.value = ''; await navigateTo(`/playlist/${playlist.id}`) }
}

function offline() { library.connected = false }
async function open() {
  await startup.start(async signal => {
    await startup.stage('library', () => library.initialize(signal))
    signal.throwIfAborted()
    await startup.stage('downloads', () => downloads.initialize())
    signal.throwIfAborted()
    await startup.stage('player', () => player.initialize())
    signal.throwIfAborted()
    const telemetry = useTelemetryStore()
    if (!telemetry.hasCachedStats) void startup.track(telemetry.refresh())
  })
}
async function revealed() {
  await nextTick()
  document.getElementById('main')?.focus({ preventScroll: true })
  if (!polling) {
    lastPoll = Date.now()
    void updates.initialize()
    releaseNotes.initialize()
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('online', library.refresh)
    window.addEventListener('offline', offline)
    polling = setInterval(() => {
      if (document.hidden || refreshing) return
      const active = library.jobs.some(job => job.state === 'processing') || library.tracks.some(track => ['pending', 'running'].includes(track.conversion))
        || Object.values(downloads.records).some(record => ['preparing', 'queued', 'downloading'].includes(record.state))
      // An unreachable PC is retried quickly at first, so the app reconnects on its own when it returns.
      const wait = !library.connected ? reconnectDelay(reconnectAttempt) : active ? 2500 : 30000
      if (Date.now() - lastPoll < wait) return
      refreshing = true; lastPoll = Date.now()
      void library.refresh().then(() => { reconnectAttempt = library.connected ? 0 : reconnectAttempt + 1; return useTelemetryStore().refresh() }).finally(() => { refreshing = false })
    }, 2500)
  }
}
onMounted(() => { void open(); window.addEventListener('scroll', trackScroll, { passive: true }) })
onBeforeUnmount(() => { window.removeEventListener('scroll', trackScroll); cancelAnimationFrame(scrollFrame); startup.cancel(); if (polling) clearInterval(polling); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', library.refresh); window.removeEventListener('offline', offline) })
</script>

<template>
  <NuxtPwaManifest />
  <StartupScreen @retry="open" @revealed="revealed" />
  <div class="app-shell" :style="artistChromeStyle" :inert="startup.blocked" :aria-hidden="startup.blocked ? true : undefined" :class="{ 'artist-chrome': artistChrome, 'motion-paused': hidden, 'has-queue': player.queueOpen, 'has-mini': !!player.current, 'dock-compact': phone && compactDock, 'startup-pending': startup.visible, 'startup-revealing': startup.phase === 'revealing' }">
    <a href="#main" class="skip-link">Ir al contenido</a>
    <div class="status-backdrop" aria-hidden="true" />
    <aside class="sidebar glass" aria-label="Navegación principal">
      <NuxtLink to="/" class="brand" aria-label="Openfy, inicio"><img src="/icons/openfy.svg" alt="" width="34" height="34"><span>openfy<span class="brand-dot">.</span></span></NuxtLink>
      <nav><NuxtLink v-for="item in nav.filter(item => item.to !== '/search')" :key="item.to" :to="item.to" :class="{ current: currentNav(item.to) }"><OIcon :name="item.icon" />{{ item.label }}</NuxtLink></nav>
      <div class="sidebar-library"><header><span>Tu colección</span><button class="icon-button" :disabled="!library.connected" aria-label="Crear playlist" @click="playlistOpen = true"><OIcon name="plus" :size="19" /></button></header>
        <NuxtLink to="/most-played" class="collection-link" :class="{ current: route.path === '/most-played' }"><span class="download-cover"><OIcon name="headphones" :size="23" /></span><span class="track-copy"><strong>Más reproducidas</strong><span>Tu historial de escucha</span></span></NuxtLink>
        <NuxtLink to="/favorites" class="collection-link" :class="{ current: route.path === '/favorites' }"><AlbumCover favorite /><span class="track-copy"><strong>Tus favoritas</strong><span>{{ songCount([...library.collectionMap.values()].filter(t => t.favorite).length) }}</span></span></NuxtLink>
        <NuxtLink to="/downloads" class="collection-link" :class="{ current: route.path === '/downloads' }"><span class="download-cover"><OIcon name="download" :size="23" /></span><span class="track-copy"><strong>Descargas</strong><span>En este dispositivo</span></span></NuxtLink>
        <NuxtLink v-for="playlist in library.playlists" :key="playlist.id" :to="`/playlist/${playlist.id}`" class="collection-link" :class="{ current: route.path === `/playlist/${playlist.id}` }"><AlbumCover :src="library.collectionMap.get(playlist.trackIds[0] || '')?.artwork" /><span class="track-copy"><strong>{{ playlist.name }}</strong><span>Playlist · {{ songCount(playlist.trackIds.length) }}</span></span></NuxtLink>
        <div v-if="!library.playlists.length" class="sidebar-empty"><p>Un lugar para cada momento.</p><span>Crea tu primera playlist.</span><button class="button subtle" :disabled="!library.connected" @click="playlistOpen = true">Crear playlist</button></div>
      </div>
      <footer><NuxtLink to="/settings" :class="{ current: route.path === '/settings' }"><OIcon name="settings" />Ajustes</NuxtLink><span class="connection" :class="{ connected: library.connected }"><i></i>{{ library.connected ? 'Conectado a tu PC' : 'PC desconectado' }}</span></footer>
    </aside>

    <div class="main-column" :class="{ 'search-active': route.path === '/search' }">
      <header class="topbar"><div class="topbar-left"><DetailBar v-if="route.path.startsWith('/music/artist/')" variant="icon" fallback="/search" /><NuxtLink v-else to="/" class="mobile-brand" aria-label="Openfy, inicio" @click="tabClick('/')">openfy<span class="brand-dot">.</span></NuxtLink></div><GlobalSearchField /><div class="topbar-actions"><button class="button subtle import-top" :disabled="!library.connected || library.importing" @click="importOpen = true"><OIcon :name="library.importing ? 'loading' : 'plus'" :size="18" :class="{ spin: library.importing }" />{{ library.importing ? 'Importando…' : 'Importar música' }}</button><NuxtLink class="avatar" to="/settings" aria-label="Abrir ajustes" title="Ajustes"><OIcon name="settings" :size="18" /></NuxtLink></div></header>
      <main id="main" tabindex="-1">
        <div v-if="library.error || downloads.storageError || player.error" class="notice error" role="status"><span>{{ library.error || downloads.storageError || player.error }}</span><button class="icon-button" aria-label="Cerrar aviso" @click="library.error = ''; downloads.storageError = ''; player.error = ''"><OIcon name="close" :size="17" /></button></div>
        <div v-if="ready && !library.connected" class="notice offline-notice"><OIcon name="offline" :size="18" /><span>Tu PC está desconectado. Tu música descargada sigue contigo.</span><button @click="library.refresh">Reintentar</button></div>
        <div v-if="library.importing" class="notice" role="status"><OIcon name="loading" class="spin" :size="18" /><span>Importando {{ library.importLabel }}</span></div>
        <div v-if="updates.available" class="notice" role="status"><span>{{ updates.status }}</span><button @click="updates.apply(true)">Actualizar y reiniciar</button><button @click="updates.postpone">Posponer</button></div>
        <NuxtPage v-if="ready" />
      </main>
    </div>
    <PlayerBar />
    <nav class="mobile-nav glass" aria-label="Navegación móvil" @click.capture="expandDock"><NuxtLink v-for="item in [...nav, { to: '/downloads', icon: 'download', label: 'Descargas' }]" :key="item.to" :to="item.to" :class="{ current: activeTab === item.to }" @click="tabClick(item.to)"><OIcon :name="item.icon" :size="22" /><span>{{ item.label }}</span></NuxtLink></nav>
  </div>
  <AppDialog :open="importOpen" title="Añade tu música" @close="importOpen = false"><p class="muted">Elige archivos de este dispositivo. Openfy guarda una copia en tu biblioteca personal del PC.</p><div class="import-options"><button class="menu-action" @click="fileInput?.click()"><OIcon name="music" />Seleccionar archivos</button><button v-if="!coarsePointer" class="menu-action" @click="folderInput?.click()"><OIcon name="folder" />Seleccionar una carpeta</button></div><p class="small muted">MP3, AAC, M4A y FLAC · Hasta 1 GB por archivo.<br>Las versiones para el iPhone se preparan en tu PC.</p></AppDialog>
  <ReleaseNotesDialog />
  <input ref="fileInput" data-testid="file-input" type="file" accept=".mp3,.aac,.m4a,.flac" multiple hidden @change="selectFiles">
  <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="selectFiles">
  <AppDialog :open="playlistOpen" title="Nueva playlist" @close="playlistOpen = false"><form @submit.prevent="createPlaylist"><label for="playlist-name">Nombre</label><input id="playlist-name" v-model="playlistName" maxlength="100" placeholder="Por ejemplo, Gym" required autocomplete="off"><button class="button primary" type="submit" :disabled="!playlistName.trim() || !library.connected">Crear playlist</button></form></AppDialog>
</template>
