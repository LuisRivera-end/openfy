import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAudio } from '../helpers/audio'
import type { Library, Track, YouTubeSong } from '../../shared/types/music'
import { importButton } from '../helpers/ui'

let root: string, fixture: Track
const songs: YouTubeSong[] = [1, 2].map(number => ({ videoId: `OfflineYT0${number}`, title: `Offline YouTube ${number}`,
  artists: ['Openfy'], album: 'Offline browser check', artwork: null, duration: 35 }))

test.beforeAll(async ({ request }) => {
  root = await mkdtemp(join(tmpdir(), 'openfy-offline-browser-'))
  const path = join(root, 'Offline browser fixture.m4a')
  generateAudio(path, { format: 'aac', duration: 35 })
  const imported = await (await request.post('/api/imports?filename=Offline%20browser%20fixture.m4a', {
    data: await readFile(path), headers: { 'Content-Type': 'application/octet-stream' },
  })).json()
  await expect.poll(async () => (await (await request.get('/api/imports')).json()).find((job: { id: string }) => job.id === imported.id)?.state).toMatch(/complete|duplicate/)
  const library = await (await request.get('/api/library')).json() as Library
  fixture = library.tracks.find(track => track.title === 'Offline browser fixture')!
})
test.afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

test.describe('downloaded resources', () => {
  test.use({ serviceWorkers: 'block' })
  test('recovers lyrics for a legacy download on retry and reuses the saved result', async ({ page, request }) => {
    const song = { ...songs[0]!, videoId: 'LegacyLyr01', title: 'Descarga anterior a las letras' }
    await request.put('/api/music/saved', { data: { song } })
    await request.post('/__test/youtube-local', { data: { videoId: song.videoId, assetId: fixture.original.id, duration: fixture.duration } })
    let playlist = await (await request.post('/api/playlists', { data: { name: `Legacy lyrics ${Date.now()}` } })).json()
    playlist = await (await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: [`youtube:${song.videoId}`] } })).json()
    let requests = 0, retried = false
    await page.route('**/api/lyrics/resolve', async route => {
      const body = route.request().postDataJSON()
      if (body.entry.song?.videoId !== song.videoId) return route.continue()
      requests++
      expect(body.localOnly).not.toBe(true)
      retried ||= !!body.refresh
      await route.fulfill({ json: {
        key: `youtube:${song.videoId}`, signature: { title: song.title, artists: song.artists, album: song.album, duration: body.duration },
        status: retried ? 'synced' : 'not_found', source: retried ? 'lrclib' : null, attribution: null, sourceUrl: null,
        fetchedAt: Date.now(), expiresAt: Date.now() + 86400000, format: 2,
        plainText: retried ? 'Verso recuperado' : '', lines: retried ? [{ time: 0, text: 'Verso recuperado' }] : [],
      } })
    })
    const openPanel = async () => {
      await expect(importButton(page)).toBeEnabled()
      await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
      const lyricsButton = page.getByRole('button', { name: 'Mostrar letras', exact: true })
      if (await lyricsButton.isVisible()) await lyricsButton.click()
      else await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
      return page.getByRole('region', { name: 'Letra de la canción' })
    }
    await page.goto(`/playlist/${playlist.id}`)
    const panel = await openPanel()
    await expect(panel.getByText('No encontramos letras para esta canción.', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Reintentar letras', exact: true }).click()
    await expect(panel.getByText('Verso recuperado', { exact: true })).toBeVisible()
    expect(retried).toBe(true)
    const beforeReload = requests
    await page.reload()
    await expect((await openPanel()).getByText('Verso recuperado', { exact: true })).toBeVisible()
    expect(requests).toBe(beforeReload)
  })

  test('switches an active stream to a completed download without losing playback position', async ({ page, request }) => {
    const song = { ...songs[0]!, videoId: 'LocalSwitch', title: 'Descarga durante reproducción' }
    const removed = await request.delete(`/api/music/youtube/${song.videoId}/local-audio`)
    expect(await removed.json()).toEqual({ ok: true })
    await request.post(`/__test/youtube-audio?videoId=${song.videoId}`, { data: await readFile(join(root, 'Offline browser fixture.m4a')) })
    await request.put('/api/music/saved', { data: { song } })
    let playlist = await (await request.post('/api/playlists', { data: { name: `Stream to local ${Date.now()}` } })).json()
    playlist = await (await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: [`youtube:${song.videoId}`] } })).json()
    await page.goto(`/playlist/${playlist.id}`)
    await expect(importButton(page)).toBeEnabled()
    await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
    const audio = page.getByTestId('audio-engine')
    await expect(audio).toHaveAttribute('src', `/api/music/youtube/${song.videoId}/stream`)
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(1)
    const at = await audio.evaluate((element: HTMLAudioElement) => element.currentTime)
    await request.post('/__test/youtube-local', { data: { videoId: song.videoId, assetId: fixture.original.id, duration: fixture.duration } })
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(audio).toHaveAttribute('src', `/api/assets/${fixture.original.id}?stream=1`)
    await expect(audio).toHaveJSProperty('paused', false)
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThanOrEqual(at - .1)
  })

  test('keeps online playback, expired lyrics, absent covers and audio failures local', async ({ page, request }) => {
    const song = { ...songs[0]!, videoId: 'LocalOnly01', artwork: 'https://lh3.googleusercontent.com/local-only-test=w120-h120' }
    const lyrics = { key: `youtube:${song.videoId}`, signature: { title: song.title, artists: song.artists, album: song.album, duration: fixture.duration },
      status: 'synced', source: 'lrclib', attribution: 'Letras guardadas', sourceUrl: null,
      fetchedAt: 1, expiresAt: 1, format: 1, plainText: 'Verso descargado', lines: [{ time: 0, text: 'Verso descargado' }] }
    await request.put('/api/music/saved', { data: { song } })
    await request.post('/__test/youtube-local', { data: { videoId: song.videoId, assetId: fixture.original.id, duration: fixture.duration, lyrics } })
    const stream = `/api/music/youtube/${song.videoId}/stream`
    const redirect = await request.get(stream, { maxRedirects: 0 })
    expect(redirect.status()).toBe(307)
    expect(redirect.headers().location).toBe(`/api/assets/${fixture.original.id}`)
    const range = await request.get(stream, { headers: { Range: 'bytes=0-31' } })
    expect(range.status()).toBe(206)
    expect((await range.body()).length).toBe(32)
    expect((await request.head(stream)).status()).toBe(200)
    const refreshed = await request.post('/api/lyrics/resolve', { data: { entry: { source: 'youtube', song }, duration: 999, refresh: true, localOnly: true } })
    expect(await refreshed.json()).toEqual(lyrics)
    expect((await request.get(`/api/artwork/remote?url=${encodeURIComponent(song.artwork)}`)).status()).toBe(502)
    let playlist = await (await request.post('/api/playlists', { data: { name: `Local resources ${Date.now()}` } })).json()
    playlist = await (await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: [`youtube:${song.videoId}`] } })).json()
    const remoteCovers: string[] = []
    page.on('request', req => { if (req.url().includes('/api/artwork/remote')) remoteCovers.push(req.url()) })
    await request.post('/__test/local-playback', { data: {} })
    const path = `/playlist/${playlist.id}`
    try {
      await page.goto(path)
      await expect(importButton(page)).toBeEnabled()
      await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
      const audio = page.getByTestId('audio-engine')
      await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(.1)
      expect(await audio.getAttribute('src')).toContain(`/api/assets/${fixture.original.id}`)
      const lyricsButton = page.getByRole('button', { name: 'Mostrar letras', exact: true })
      if (await lyricsButton.isVisible()) await lyricsButton.click()
      else await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Letra de la canción' }).getByText('Verso descargado', { exact: true })).toBeVisible()
      expect(remoteCovers).toEqual([])
      expect(await (await request.get('/__test/local-playback')).json()).toEqual([])
      await request.post('/__test/local-playback', { data: { assetId: fixture.original.id, available: false } })
      // The successful playback was cached as immutable. Force a fresh media
      // URL so the failed socket response reaches both native browser decoders.
      await page.addInitScript(() => {
        const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!
        Object.defineProperty(HTMLMediaElement.prototype, 'src', { ...src, set(value: string) {
          src.set!.call(this, value.startsWith('/api/assets/') ? `${value}?failure-test=${Date.now()}` : value)
        } })
      })
      await page.reload()
      await expect(importButton(page)).toBeEnabled()
      await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
      await expect(page.getByText('No se pudo abrir la copia descargada. Vuelve a descargar esta canción.', { exact: true }).first()).toBeVisible()
      expect(await (await request.get('/__test/local-playback')).json()).toEqual([])
      expect(remoteCovers).toEqual([])
    } finally { await request.post('/__test/local-playback', { data: { assetId: fixture.original.id, available: true } }) }
  })
})

test('keeps a downloaded playlist updated and plays YouTube identities offline', async ({ page, context, request }, info) => {
  test.setTimeout(90000)
  // Provider acquisition has separate real-file integration coverage. Here the
  // existing asset endpoint serves a synthesized AAC file to both browser engines.
  let remoteStreams = 0
  await page.route('**/api/music/youtube/*/stream', async route => { remoteStreams++; await route.abort() })
  for (const song of songs) {
    await request.put('/api/music/saved', { data: { song } })
    expect((await request.post('/__test/youtube-local', { data: { videoId: song.videoId, assetId: fixture.original.id, duration: fixture.duration } })).ok()).toBe(true)
  }
  let playlist = await (await request.post('/api/playlists', { data: { name: `Offline playlist ${Date.now()}` } })).json()
  playlist = await (await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: [`youtube:${songs[0]!.videoId}`] } })).json()
  await page.goto(`/playlist/${playlist.id}`)
  await expect(importButton(page)).toBeEnabled()
  const indicators = page.getByRole('img', { name: 'Descargada en este dispositivo', exact: true })
  // A PC copy alone must not advertise an offline copy on this device.
  await expect(indicators).toHaveCount(0)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
  await page.getByRole('button', { name: 'Descargar esta colección', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mantener descargado · 1/1', exact: true })).toBeVisible()
  await expect(indicators).toBeVisible()
  await context.setOffline(true)
  playlist = await (await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: songs.map(song => `youtube:${song.videoId}`) } })).json()
  await context.setOffline(false)
  await expect(page.getByRole('button', { name: 'Mantener descargado · 2/2', exact: true })).toBeVisible({ timeout: 40000 })
  await expect(indicators).toHaveCount(2)
  await expect(indicators.first()).toBeVisible()
  await indicators.first().evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await page.screenshot({ path: `output/playwright/${info.project.name}-playlist-download-indicators.png`, scale: 'css' })
  // Removing a member keeps the verified device copy.
  await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: [`youtube:${songs[1]!.videoId}`] } })
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.goto('/downloads')
  await expect(page.getByText('2 canciones descargadas', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('2 canciones descargadas', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Escuchar descargas', exact: true }).click()
  const audio = page.getByTestId('audio-engine')
  await expect(audio).toHaveJSProperty('paused', false)
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(.1)
  expect(await audio.getAttribute('src')).toContain('/api/assets/')
  expect(remoteStreams).toBe(0)
  await page.getByRole('button', { name: 'Pausar', exact: true }).first().click()
  await context.setOffline(false)
  const second = page.locator('.download-row').filter({ hasText: songs[1]!.title })
  await second.getByRole('button', { name: 'Eliminar descarga de este dispositivo', exact: true }).click()
  await page.getByRole('dialog', { name: 'Eliminar descarga' }).getByRole('button', { name: 'Eliminar descarga', exact: true }).click()
  await expect(second).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('1 canción descargada', { exact: true })).toBeVisible()
  await expect(page.locator('.download-row').filter({ hasText: songs[1]!.title })).toHaveCount(0)
  await page.goto(`/playlist/${playlist.id}`)
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(indicators).toHaveCount(0)
  // Serve fixtures over HTTP: the active service worker can bypass page routing in WebKit.
  expect((await request.post('/__test/music-search', { data: { query: 'Offline indicators', songs } })).ok()).toBe(true)
  await page.goto('/search')
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music', exact: true }).fill('Offline indicators')
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('listitem').filter({ hasText: songs[0]!.title }).getByRole('img', { name: 'Descargada en este dispositivo' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: songs[1]!.title }).getByRole('img', { name: 'Descargada en este dispositivo' })).toHaveCount(0)
  await page.getByRole('listitem').first().evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await page.screenshot({ path: `output/playwright/${info.project.name}-search-download-indicators.png`, scale: 'css' })
})

test('preserves an explicit download request while waiting for the PC across a reload', async ({ page, context, request }) => {
  const song = { ...songs[0]!, videoId: 'OfflineYT03', title: 'Solicitud pendiente' }
  await request.put('/api/music/saved', { data: { song } })
  const job = { id: 'pending-test', videoId: song.videoId, song, state: 'failed', bytes: 0, total: 0, attempts: 3,
    error: 'Error simulado recuperable.', errorCode: 'DOWNLOAD_FAILED', suppressed: false, createdAt: 1, updatedAt: 1 }
  await request.post('/__test/download-requests', { data: job })
  await page.goto('/downloads')
  await expect(importButton(page)).toBeEnabled()
  await page.evaluate(async song => {
    await navigator.serviceWorker.ready
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('openfy'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error) })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('downloads', 'readwrite')
      tx.objectStore('downloads').put({ trackId: `youtube:${song.videoId}`, entry: { source: 'youtube', song }, assetId: '', state: 'preparing', manual: true, bytes: 0, total: 0, error: null, updatedAt: Date.now() })
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    }); db.close()
  }, song)
  await context.setOffline(true); await page.reload()
  await expect(page.getByText('Esperando al PC', { exact: true })).toBeVisible()
  await context.setOffline(false)
  await expect.poll(async () => (await (await request.get('/__test/download-requests')).json()).intents[0]).toBe('manual')
  await expect(page.getByText(job.error, { exact: true })).toBeVisible()
})

test('downloads all favorites from the header even when search and downloaded-only hide them', async ({ page, request }, info) => {
  const existing = await (await request.get('/api/library')).json() as Library
  for (const track of existing.tracks.filter(track => track.favorite)) await request.put(`/api/tracks/${track.id}/favorite`, { data: { favorite: false } })
  for (const saved of (existing.youtubeSongs || []).filter(saved => saved.favorite)) await request.put('/api/music/saved', { data: { song: saved.song, favorite: false } })
  const favorites = [1, 2].map(number => ({ ...songs[0]!, videoId: `FavoriteQ0${number}`, title: `Favorita para descargar ${number}` }))
  const other = { ...songs[0]!, videoId: 'FavoriteQ03', title: 'Guardada sin marcar favorita' }
  for (const song of [...favorites, other]) {
    expect((await request.put('/api/music/saved', { data: { song, favorite: song !== other } })).ok()).toBe(true)
    expect((await request.post('/__test/youtube-local', { data: { videoId: song.videoId, assetId: fixture.original.id, duration: fixture.duration } })).ok()).toBe(true)
  }
  await page.goto('/favorites')
  await expect(importButton(page)).toBeEnabled()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
  await page.getByRole('textbox', { name: 'Filtrar canciones', exact: true }).fill(favorites[0]!.title)
  await page.getByRole('button', { name: 'Solo descargadas', exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(0)
  const download = page.getByRole('button', { name: 'Descargar favoritas', exact: true })
  await expect(download).toBeEnabled()
  await download.click()
  await expect.poll(() => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open('openfy'); open.onerror = () => reject(open.error)
    open.onsuccess = () => { const db = open.result; const get = db.transaction('downloads').objectStore('downloads').getAll(); get.onsuccess = () => { resolve(get.result.filter((row: { state: string }) => row.state === 'ready').map((row: { trackId: string }) => row.trackId).sort()); db.close() }; get.onerror = () => reject(get.error) }
  }))).toEqual(favorites.map(song => `youtube:${song.videoId}`).sort())
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: 'Borrar búsqueda', exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await page.screenshot({ path: `output/playwright/${info.project.name}-download-favorites.png`, scale: 'css' })
})
