import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { generateAudio } from '../helpers/audio'
import type { Library, Track, YouTubeSong } from '../../shared/types/music'
import { addToQueue, importButton } from '../helpers/ui'

// WebKit's service worker bypasses Playwright's route interception. Keep mocked
// provider tests deterministic; openfy.spec.ts exercises the real offline PWA.
test.use({ serviceWorkers: 'block' })

const songs: YouTubeSong[] = [
  { videoId: 'abcdefghijk', title: 'Horizonte remoto', artists: ['Openfy'], album: 'Descubrimientos', artwork: null, duration: 20 },
  { videoId: '12345678901', title: 'Segunda remota', artists: ['Otro artista'], album: null, artwork: null, duration: null },
]
let directory: string
let audio: Buffer
let local: Track

async function boot(page: Page) {
  await page.goto('/search')
  await expect(importButton(page)).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'Buscar en YouTube Music' })).toBeVisible()
  await page.getByRole('tab', { name: 'Canciones', exact: true }).click()
}
async function mockSearch(page: Page) {
  await page.route('**/api/music/search?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('type') === 'artist' ? { artists: [], nextCursor: null } : { songs } }))
}
async function showQueue(page: Page) {
  const button = page.getByRole('button', { name: 'Mostrar cola', exact: true })
  if (await button.isVisible()) await button.click()
  else {
    await page.getByRole('button', { name: 'Abrir reproductor ampliado' }).click()
    await page.getByRole('button', { name: 'Abrir cola desde reproductor ampliado' }).click()
  }
}
/** Desktop docks the queue beside the page; phones open it as a sheet over the expanded player. */
const queuePanel = (page: Page) => page.getByRole('complementary', { name: 'Cola de reproducción' }).or(page.getByRole('dialog', { name: 'Cola de reproducción' }))
async function closeQueue(page: Page) {
  const close = page.getByRole('button', { name: 'Cerrar cola', exact: true })
  if (await close.isVisible()) return close.click()
  await page.getByRole('dialog', { name: 'Cola de reproducción' }).getByRole('button', { name: 'Cerrar diálogo', exact: true }).click()
  await page.getByRole('button', { name: 'Cerrar reproductor ampliado', exact: true }).click()
}

test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-youtube-'))
  const path = join(directory, 'Busqueda local.m4a')
  generateAudio(path, { duration: 20, format: 'aac', frequency: 370 })
  audio = await readFile(path)
  expect((await request.post('/__test/youtube-audio', { data: audio })).ok()).toBe(true)
  const imported = await request.post('/api/imports?filename=Busqueda%20local.m4a', { data: audio, headers: { 'Content-Type': 'application/octet-stream' } })
  expect(imported.status()).toBe(202)
  await expect.poll(async () => (await (await request.get('/api/library')).json() as Library).tracks.some(track => track.title === 'Busqueda local')).toBe(true)
  local = (await (await request.get('/api/library')).json() as Library).tracks.find(track => track.title === 'Busqueda local')!
})
test.beforeEach(async ({ request }) => { await request.put('/__test/youtube-audio?status=200') })

test('saves remote favorites and ordered mixed playlists across reloads', async ({ page, request }) => {
  const playlist = await (await request.post('/api/playlists', { data: { name: `GYM remota ${Date.now()}` } })).json()
  const initial = await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: [local.id] } })
  expect(initial.ok()).toBe(true)
  const before = await initial.json()
  expect((await request.put(`/api/playlists/${playlist.id}`, { data: { ...before, trackIds: ['youtube:zzzzzzzzzzz'] } })).status()).toBe(400)
  expect((await request.put('/api/music/saved', { data: { song: { ...songs[0], videoId: 'bad' } } })).status()).toBe(400)
  await request.put('/api/music/saved', { data: { song: songs[0], favorite: false } })
  await mockSearch(page)
  await boot(page)
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('horizonte')
  await page.getByRole('button', { name: 'Opciones de Horizonte remoto', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Añadir a favoritos', exact: true }).click()
  await expect.poll(async () => (await (await request.get('/api/library')).json() as Library).youtubeSongs?.find(saved => saved.song.videoId === songs[0]!.videoId)?.favorite).toBe(true)
  await page.getByRole('button', { name: 'Opciones de Horizonte remoto', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: playlist.name, exact: true }).click()
  await expect.poll(async () => (await (await request.get('/api/library')).json() as Library).playlists.find(list => list.id === playlist.id)?.trackIds).toEqual([local.id, 'youtube:abcdefghijk'])
  // Idempotent metadata saves must retain the favorite and never create audio assets.
  expect((await request.put('/api/music/saved', { data: { song: songs[0] } })).ok()).toBe(true)
  await page.goto(`/playlist/${playlist.id}`)
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('listitem').nth(1)).toContainText('Horizonte remoto')
  await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
  await showQueue(page)
  await expect(page.getByRole('button', { name: 'Escuchar Horizonte remoto', exact: true })).toBeVisible()
  await page.goto('/favorites')
  await expect(page.getByRole('button', { name: 'Reproducir Horizonte remoto', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Reproducir Horizonte remoto', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Opciones de Horizonte remoto', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Quitar de favoritos', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reproducir Horizonte remoto', exact: true })).toHaveCount(0)
  const current = (await (await request.get('/api/library')).json() as Library).playlists.find(list => list.id === playlist.id)!
  expect((await request.put(`/api/playlists/${playlist.id}`, { data: { ...before, trackIds: [] } })).status()).toBe(409)
  expect((await request.put(`/api/playlists/${playlist.id}`, { data: { ...current, trackIds: ['youtube:abcdefghijk', local.id] } })).ok()).toBe(true)
  const saved = (await (await request.get('/api/library')).json() as Library).youtubeSongs!.filter(item => item.song.videoId === songs[0]!.videoId)
  expect(saved).toHaveLength(1)
  expect((await request.put('/api/tracks/youtube:zzzzzzzzzzz/favorite', { data: { favorite: true } })).status()).toBe(404)
})
test.afterAll(async () => {
  if (!directory) return
  const target = resolve(directory)
  expect(target.startsWith(resolve(tmpdir()) + sep)).toBe(true)
  await rm(target, { recursive: true, force: true })
})

test('validates search input, video IDs, methods and private access', async ({ request }) => {
  expect((await request.get('/api/music/search?q=a')).status()).toBe(400)
  expect((await request.get('/api/music/search', { params: { q: 'a'.repeat(201) } })).status()).toBe(400)
  expect((await request.get('/api/music/search', { params: { q: 'Openfy', cursor: 'invalid' } })).status()).toBe(400)
  expect((await request.get('/api/music/youtube/invalid/stream')).status()).toBe(400)
  expect((await request.head('/api/music/youtube/invalid/stream')).status()).toBe(400)
  expect((await request.post('/api/music/youtube/abcdefghijk/stream')).status()).toBe(405)
  expect((await request.get('/api/music/search?q=abc', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status()).toBe(403)
})

test('debounces search, handles empty results and keeps local search in the library', async ({ page }) => {
  const requests: string[] = []
  await page.route('**/api/music/search?*', route => {
    if (new URL(route.request().url()).searchParams.get('type') === 'album') return route.fulfill({ json: { albums: [], nextCursor: null } })
    if (new URL(route.request().url()).searchParams.get('type') === 'artist') return route.fulfill({ json: { artists: [], nextCursor: null } })
    requests.push(new URL(route.request().url()).searchParams.get('q')!)
    return route.fulfill({ json: { songs: requests.at(-1) === 'nada' ? [] : songs } })
  })
  await boot(page)
  await expect(page.getByRole('tab', { name: 'Canciones', exact: true })).toHaveAttribute('aria-selected', 'true')
  const input = page.getByRole('textbox', { name: 'Buscar en YouTube Music' })
  await input.fill('a')
  await page.waitForTimeout(400)
  expect(requests).toHaveLength(0)
  await input.fill('hor'); await input.fill('horizonte')
  await expect(page.getByRole('listitem')).toHaveCount(2)
  expect(requests).toEqual(['horizonte'])
  await input.fill('nada')
  await expect(page.getByText('No hay canciones que coincidan. Prueba con otro título o artista.')).toBeVisible()
  await page.goto('/library')
  await page.getByRole('textbox', { name: 'Filtrar canciones', exact: true }).fill('busqueda local')
  await expect(page.getByRole('button', { name: 'Reproducir Busqueda local', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Solo descargadas', exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(0)
})

test('ignores delayed responses and lets the user retry a failed search', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/music/search?*', async route => {
    if (new URL(route.request().url()).searchParams.get('type') === 'album') return route.fulfill({ json: { albums: [], nextCursor: null } })
    if (new URL(route.request().url()).searchParams.get('type') === 'artist') return route.fulfill({ json: { artists: [], nextCursor: null } })
    const q = new URL(route.request().url()).searchParams.get('q')
    if (q === 'lenta') {
      await new Promise(resolve => setTimeout(resolve, 900))
      await route.fulfill({ json: { songs: [{ ...songs[0], title: 'Respuesta vieja' }] } }).catch(() => {})
    } else if (q === 'error' && attempts++ === 0) await route.fulfill({ status: 503, json: { message: 'Proveedor temporalmente no disponible.' } })
    else await route.fulfill({ json: { songs } })
  })
  await boot(page)
  const input = page.getByRole('textbox', { name: 'Buscar en YouTube Music' })
  await input.fill('lenta')
  await page.waitForRequest('**/api/music/search?q=lenta')
  await input.fill('rapida')
  await expect(page.getByRole('button', { name: 'Reproducir Horizonte remoto', exact: true })).toBeVisible()
  await page.waitForTimeout(1000)
  await expect(page.getByText('Respuesta vieja')).toHaveCount(0)
  await input.fill('error')
  await expect(page.getByText('Proveedor temporalmente no disponible.')).toBeVisible()
  await page.getByRole('button', { name: 'Reintentar búsqueda' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(2)
})

test('plays YouTube in the existing player, persists a mixed queue and never caches remote audio', async ({ page, request }, info) => {
  await mockSearch(page)
  await boot(page)
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('horizonte')
  await page.getByRole('button', { name: 'Reproducir Horizonte remoto', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await expect.poll(async () => page.getByTestId('audio-engine').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.2)
  await showQueue(page)
  await expect(queuePanel(page).getByText('Segunda remota')).toBeVisible()
  await closeQueue(page)
  await page.getByRole('button', { name: 'Abrir reproductor ampliado' }).click()
  await expect(page.getByRole('dialog').getByText('YouTube Music', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Marcar favorito' })).toBeVisible()
  await page.getByRole('slider', { name: 'Posición en reproductor ampliado' }).evaluate((element: HTMLInputElement) => { element.value = '6'; element.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.getByRole('button', { name: 'Pausar en reproductor ampliado' }).click()
  await page.getByRole('button', { name: 'Cerrar reproductor ampliado' }).click()
  await page.goto('/library')
  await page.getByRole('textbox', { name: 'Filtrar canciones', exact: true }).fill('busqueda local')
  await page.getByRole('button', { name: 'Opciones de Busqueda local', exact: true }).click()
  await page.getByRole('button', { name: 'Añadir a la cola', exact: true }).click()
  await showQueue(page)
  await expect(page.getByRole('button', { name: 'Escuchar Busqueda local', exact: true })).toBeVisible()
  const before = (await (await request.get('/__test/youtube-audio')).json()).requests
  await page.reload()
  await expect(page.getByRole('button', { name: 'Abrir reproductor ampliado' })).toContainText('Horizonte remoto')
  await page.waitForTimeout(500)
  expect((await (await request.get('/__test/youtube-audio')).json()).requests).toBe(before)
  expect(await page.getByTestId('audio-engine').evaluate((element: HTMLAudioElement) => element.paused && !element.getAttribute('src'))).toBe(true)
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect.poll(async () => page.getByTestId('audio-engine').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThanOrEqual(5.5)
  await showQueue(page)
  await page.getByRole('button', { name: 'Escuchar Busqueda local', exact: true }).click()
  await expect(page.getByTestId('audio-engine')).toHaveAttribute('src', `/api/assets/${local.mobile!.id}?stream=1`)
  await closeQueue(page)
  await page.goto('/search')
  await page.getByRole('tab', { name: 'Canciones', exact: true }).click()
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('horizonte')
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await page.screenshot({ path: `output/playwright/${info.project.name}-youtube-search.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.evaluate(async () => {
    const keys = await caches.keys()
    for (const key of keys) if ((await (await caches.open(key)).keys()).some(request => request.url.includes('/api/music/'))) return true
    return false
  })).toBe(false)
})

test('shows disconnection and keeps downloaded library navigation available', async ({ page, context }) => {
  await mockSearch(page)
  await boot(page)
  await page.getByRole('link', { name: 'Tu biblioteca', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tu biblioteca', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('sin conexión')
  await expect(page).toHaveURL(/\/search$/)
  await expect(page.getByRole('tab', { name: 'Canciones', exact: true })).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByRole('heading', { name: 'Conecta para descubrir música.' })).toBeVisible()
  await page.getByRole('link', { name: 'Tu biblioteca', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tu biblioteca', exact: true })).toBeVisible()
})

test('synchronizes measured durations across song lists, playback, seeking and paused restoration', async ({ page }) => {
  await page.route('**/api/music/search?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('type') === 'artist'
    ? { artists: [], nextCursor: null } : { songs: [{ ...songs[0], duration: 208 }] } }))
  await boot(page)
  const input = page.getByRole('textbox', { name: 'Buscar en YouTube Music' })
  await input.fill('horizonte')
  const row = page.getByRole('listitem').filter({ hasText: 'Horizonte remoto' })
  await expect(row.locator('.track-duration')).toHaveText('3:28')
  await page.getByRole('button', { name: 'Reproducir Horizonte remoto', exact: true }).click()
  await expect.poll(async () => page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.2)
  await expect(row.locator('.track-duration')).toHaveText('0:20')
  await page.getByRole('button', { name: 'Abrir reproductor ampliado' }).click()
  const seek = page.getByRole('slider', { name: 'Posición en reproductor ampliado' })
  await expect.poll(async () => Number(await seek.getAttribute('max'))).toBeGreaterThanOrEqual(20)
  expect(Number(await seek.getAttribute('max'))).toBeLessThan(21)
  await seek.evaluate((element: HTMLInputElement) => { element.value = '6'; element.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.getByRole('button', { name: 'Pausar en reproductor ampliado' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Abrir reproductor ampliado' })).toContainText('Horizonte remoto')
  await page.getByRole('button', { name: 'Abrir reproductor ampliado' }).click()
  await expect.poll(async () => Number(await seek.getAttribute('max'))).toBeGreaterThanOrEqual(20)
  expect(Number(await seek.getAttribute('max'))).toBeLessThan(21)
  expect(await page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.paused && !audio.getAttribute('src'))).toBe(true)
})

test('reports playback failure and can retry the same song', async ({ page, request }) => {
  await mockSearch(page)
  await request.put('/__test/youtube-audio?status=503')
  await boot(page)
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('horizonte')
  await page.getByRole('button', { name: 'Reproducir Horizonte remoto', exact: true }).click()
  await expect(page.getByText('No se pudo reproducir esta canción de YouTube. Comprueba la conexión y toca reproducir para reintentar.')).toBeVisible()
  await request.put('/__test/youtube-audio?status=200')
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
})

test('enqueues a result and advances remote songs with the existing transport', async ({ page }, info) => {
  await mockSearch(page)
  await boot(page)
  await page.getByRole('tab', { name: 'Canciones', exact: true }).press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Artistas', exact: true })).toBeFocused()
  await page.getByRole('tab', { name: 'Artistas', exact: true }).press('ArrowLeft')
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('horizonte')
  await addToQueue(page, info, 'Horizonte remoto')
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await addToQueue(page, info, 'Segunda remota')
  await expect.poll(async () => page.getByTestId('audio-engine').evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(1)
  await page.getByTestId('audio-engine').evaluate((element: HTMLAudioElement) => { element.currentTime = element.duration - 0.2 })
  await expect(page.getByRole('button', { name: 'Abrir reproductor ampliado' })).toContainText('Segunda remota')
  await page.getByRole('button', { name: 'Abrir reproductor ampliado' }).click()
  const shuffle = page.getByRole('button', { name: 'Aleatorio en reproductor ampliado' })
  await shuffle.click()
  await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
  await shuffle.click()
  await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Pausar en reproductor ampliado' }).click()
  await page.getByRole('slider', { name: 'Posición en reproductor ampliado' }).evaluate((element: HTMLInputElement) => {
    element.value = '0'; element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'Anterior en reproductor ampliado' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Horizonte remoto' })).toBeVisible()
})

test('keeps the selected song when a native decoder ends before playback starts', async ({ page }) => {
  await mockSearch(page)
  await boot(page)
  await page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => {
    audio.addEventListener('loadeddata', () => audio.dispatchEvent(new Event('ended')), { capture: true, once: true })
  })
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('horizonte')
  await page.getByRole('button', { name: 'Reproducir Horizonte remoto', exact: true }).click()
  await expect(page.getByText('Este navegador no pudo iniciar el audio. Toca reproducir para reintentar.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir reproductor ampliado' })).toContainText('Horizonte remoto')
})

const scrollSong = (n: number): YouTubeSong => ({ ...songs[0]!, videoId: n === 1 ? songs[0]!.videoId : `scroll${String(n).padStart(5, '0')}`, title: `Canción ${n}` })
const scrollSongs = (first: number, count: number) => Array.from({ length: count }, (_, i) => scrollSong(first + i))

test('loads 20 songs then appends 10 on scroll without interrupting playback', async ({ page }, info) => {
  const cursors: Array<string | null> = []
  await page.route('**/api/music/search?*', async route => {
    if (new URL(route.request().url()).searchParams.get('type') === 'album') return route.fulfill({ json: { albums: [], nextCursor: null } })
    if (new URL(route.request().url()).searchParams.get('type') === 'artist') return route.fulfill({ json: { artists: [], nextCursor: null } })
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    cursors.push(cursor)
    await route.fulfill({ json: cursor === 'scroll:20' ? { songs: scrollSongs(21, 10), nextCursor: 'scroll:30' }
      : cursor === 'scroll:30' ? { songs: scrollSongs(31, 10), nextCursor: null }
        : { songs: scrollSongs(1, 20), nextCursor: 'scroll:20' } })
  })
  await boot(page)
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('scroll')
  await expect(page.getByRole('listitem')).toHaveCount(20)
  expect(cursors).toEqual([null])
  await page.getByRole('button', { name: 'Reproducir Canción 1', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await page.getByTestId('search-more').scrollIntoViewIfNeeded()
  await expect(page.getByRole('listitem')).toHaveCount(30)
  await expect(page.getByRole('button', { name: 'Abrir reproductor ampliado' })).toContainText('Canción 1')
  expect(cursors).toEqual([null, 'scroll:20'])
  await page.getByTestId('search-more').scrollIntoViewIfNeeded()
  await expect(page.getByRole('listitem')).toHaveCount(40)
  await expect(page.getByText('No hay más canciones para esta búsqueda.')).toBeVisible()
  expect(cursors).toEqual([null, 'scroll:20', 'scroll:30'])
  // Phones show the first songs above the artist and album rails, then the rest: both lists, in order.
  const titles = await page.locator('#youtube-results .youtube-list .track-title').allTextContents()
  expect(titles).toEqual(scrollSongs(1, 40).map(song => song.title))
  await page.screenshot({ path: `output/playwright/${info.project.name}-infinite-search.png`, fullPage: true })
})

test('preserves results after a continuation error and retries the same block once requested', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/music/search?*', route => {
    if (new URL(route.request().url()).searchParams.get('type') === 'album') return route.fulfill({ json: { albums: [], nextCursor: null } })
    if (new URL(route.request().url()).searchParams.get('type') === 'artist') return route.fulfill({ json: { artists: [], nextCursor: null } })
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    if (!cursor) return route.fulfill({ json: { songs: scrollSongs(1, 20), nextCursor: 'scroll:20' } })
    if (++attempts === 1) return route.fulfill({ status: 503, json: { message: 'Carga temporalmente no disponible.' } })
    return route.fulfill({ json: { songs: scrollSongs(21, 10), nextCursor: null } })
  })
  await boot(page)
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('scroll')
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await page.getByTestId('search-more').scrollIntoViewIfNeeded()
  await expect(page.getByText('Carga temporalmente no disponible.')).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await page.waitForTimeout(400)
  expect(attempts).toBe(1)
  await page.getByRole('button', { name: 'Reintentar carga', exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(30)
  expect(attempts).toBe(2)
})

test('discards a pending continuation after changing the query', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/music/search?*', async route => {
    if (new URL(route.request().url()).searchParams.get('type') === 'album') return route.fulfill({ json: { albums: [], nextCursor: null } })
    if (new URL(route.request().url()).searchParams.get('type') === 'artist') return route.fulfill({ json: { artists: [], nextCursor: null } })
    const query = new URL(route.request().url()).searchParams
    if (query.has('cursor')) {
      await gate
      await route.fulfill({ json: { songs: scrollSongs(21, 10), nextCursor: null } }).catch(() => {})
    } else await route.fulfill({ json: query.get('q') === 'nueva' ? { songs, nextCursor: null } : { songs: scrollSongs(1, 20), nextCursor: 'scroll:20' } })
  })
  await boot(page)
  const input = page.getByRole('textbox', { name: 'Buscar en YouTube Music' })
  await input.fill('scroll')
  await expect(page.getByRole('listitem')).toHaveCount(20)
  const continuation = page.waitForRequest(request => new URL(request.url()).searchParams.has('cursor'))
  await page.getByTestId('search-more').scrollIntoViewIfNeeded()
  await continuation
  await input.fill('nueva')
  await expect(page.getByRole('listitem')).toHaveCount(2)
  release()
  await page.waitForTimeout(200)
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByText('Canción 21', { exact: true })).toHaveCount(0)
})

test('offers to refresh an expired search while keeping the loaded songs', async ({ page }) => {
  let initialRequests = 0
  await page.route('**/api/music/search?*', route => {
    if (new URL(route.request().url()).searchParams.get('type') === 'album') return route.fulfill({ json: { albums: [], nextCursor: null } })
    if (new URL(route.request().url()).searchParams.get('type') === 'artist') return route.fulfill({ json: { artists: [], nextCursor: null } })
    if (new URL(route.request().url()).searchParams.has('cursor')) return route.fulfill({ status: 410, json: { statusCode: 410, message: 'La búsqueda caducó.' } })
    initialRequests++
    return route.fulfill({ json: { songs: scrollSongs(1, 20), nextCursor: initialRequests === 1 ? 'scroll:20' : null } })
  })
  await boot(page)
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('scroll')
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await page.getByTestId('search-more').scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Actualizar búsqueda', exact: true })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await page.getByRole('button', { name: 'Actualizar búsqueda', exact: true }).click()
  await expect(page.getByText('No hay más canciones para esta búsqueda.')).toBeVisible()
  expect(initialRequests).toBe(2)
})
