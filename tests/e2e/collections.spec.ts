import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAudio } from '../helpers/audio'
import type { Library, PlaybackSnapshotV3, YouTubeSong } from '../../shared/types/music'

test.use({ serviceWorkers: 'block' })
const songs: YouTubeSong[] = Array.from({ length: 500 }, (_, i) => ({ videoId: i === 0 ? 'abcdefghijk' : i === 1 ? '12345678901' : `coll${String(i).padStart(7, '0')}`, title: i === 0 ? 'Horizonte' : i === 1 ? 'Siénna' : `Canción ${i + 1}`, artists: ['The Marías'], album: 'Submarine', artwork: null, duration: 120 }))
const library: Library = { tracks: [], playlists: [{ id: 'collection-fixture', name: 'Una playlist con un nombre largo para volver a casa y escuchar todo el camino', revision: 1, updatedAt: 1, trackIds: songs.slice(0, 2).map(song => `youtube:${song.videoId}`) }], youtubeSongs: songs.map((song, i) => ({ song, favorite: true, addedAt: 500 - i })) }
let directory: string
test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-collections-'))
  const audio = join(directory, 'collection.m4a'); generateAudio(audio, { duration: 60, format: 'aac' })
  await request.post('/__test/youtube-audio', { data: await readFile(audio) })
  const imported = await request.post('/api/imports?filename=Collection%20descargable.m4a', { data: await readFile(audio), headers: { 'Content-Type': 'application/octet-stream' } })
  expect(imported.status()).toBe(202)
  await expect.poll(async () => ((await (await request.get('/api/library')).json()) as Library).tracks.some(track => track.title === 'Collection descargable')).toBe(true)
  await mkdir('output/playwright/collections', { recursive: true })
})
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }) })
async function open(page: Page, path = '/favorites') {
  await page.route('**/api/library', route => route.fulfill({ json: library }))
  await page.route('**/api/music/recommendations**', route => route.fulfill({ json: { songs: [], generatedAt: 0, stale: false, error: null } }))
  await page.goto(path)
  await expect(page.getByRole('textbox', { name: 'Filtrar canciones', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reproducir esta colección', exact: true })).toBeEnabled()
}
async function snapshot(page: Page) {
  return page.evaluate(() => new Promise<PlaybackSnapshotV3>((resolve, reject) => {
    const open = indexedDB.open('openfy'); open.onerror = () => reject(open.error)
    open.onsuccess = () => { const db = open.result; const get = db.transaction('snapshots').objectStore('snapshots').get('playback'); get.onsuccess = () => { resolve(get.result?.value); db.close() }; get.onerror = () => reject(get.error) }
  }))
}

test('keeps a compact, aligned header with stable totals, long names and empty results', async ({ page }, info) => {
  await open(page)
  await expect(page.locator('.collection-metadata')).toContainText('500 canciones')
  await expect(page.locator('.collection-toolbar').getByRole('combobox')).toHaveCount(0)
  await expect(page.getByText('Solo favoritas', { exact: true })).toHaveCount(0)
  for (const width of info.project.name === 'chromium' ? [1440, 960, 780, 700] : [390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('heading', { name: 'Tus favoritas', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const search = await page.locator('.collection-toolbar .search-field').boundingBox()
    const icon = await page.locator('.collection-toolbar .search-field > svg').boundingBox()
    const input = await page.getByRole('textbox', { name: 'Filtrar canciones', exact: true }).boundingBox()
    expect(Math.abs((icon!.y + icon!.height / 2) - (input!.y + input!.height / 2))).toBeLessThanOrEqual(1)
    expect(search!.height).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: `output/playwright/collections/${info.project.name}-favorites-${width}.png`, scale: 'css' })
  }
  const search = page.getByRole('textbox', { name: 'Filtrar canciones', exact: true })
  await search.fill('Sienna')
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(page.locator('.collection-metadata')).toContainText('500 canciones')
  await expect(page.locator('.collection-result-count')).toHaveText('1 de 500 canciones')
  await search.fill('no existe esta canción')
  await expect(page.getByRole('button', { name: 'Reproducir esta colección', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Reproducir esta colección en aleatorio', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Borrar búsqueda', exact: true }).click()
  await page.goto('/playlist/collection-fixture')
  await expect(page.getByRole('heading', { name: library.playlists[0]!.name, exact: true })).toBeVisible()
  if (info.project.name === 'mobile-webkit') expect((await page.locator('.collection-heading h1').boundingBox())!.height).toBeLessThan(200)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `output/playwright/collections/${info.project.name}-long-playlist.png`, scale: 'css' })
})

test('starts a full shuffled collection before audio and restores pending order, then starts normally', async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0 })
  await open(page)
  await expect(page.getByRole('listitem')).toHaveCount(100)
  await page.getByRole('button', { name: 'Reproducir esta colección en aleatorio', exact: true }).click()
  await expect.poll(async () => (await snapshot(page))?.queue.length).toBe(500)
  const mixed = await snapshot(page)
  expect(mixed.shuffle).toBe(true); expect(mixed.index).toBe(0)
  expect(mixed.queue[0]).toMatchObject({ source: 'youtube', song: { videoId: songs[1]!.videoId } })
  expect(new Set(mixed.queue.map(entry => entry.queueId)).size).toBe(500)
  const order = new Map(mixed.originalOrder.map((id, i) => [id, i]))
  // PlayerBar uses the same queue and exposes the active shuffle state.
  const shuffle = page.getByRole('button', { name: 'Reproducción aleatoria', exact: true })
  if (!(await shuffle.isVisible())) await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
  const toggle = await shuffle.isVisible() ? shuffle : page.getByRole('button', { name: 'Aleatorio en reproductor ampliado', exact: true })
  await toggle.click()
  await expect.poll(async () => (await snapshot(page))?.shuffle).toBe(false)
  const restored = await snapshot(page)
  expect(restored.queue[0]?.queueId).toBe(mixed.queue[0]?.queueId)
  expect(restored.queue.slice(1).map(entry => order.get(entry.queueId!))).toEqual([0, ...Array.from({ length: 498 }, (_, i) => i + 2)])
  const close = page.getByRole('button', { name: 'Cerrar reproductor ampliado', exact: true })
  if (await close.isVisible()) await close.click()
  await page.getByRole('textbox', { name: 'Filtrar canciones', exact: true }).fill('Sienna')
  await page.getByRole('button', { name: 'Reproducir esta colección en aleatorio', exact: true }).click()
  await expect.poll(async () => (await snapshot(page))?.queue.length).toBe(1)
  expect((await snapshot(page)).shuffle).toBe(true)
  await page.getByRole('button', { name: 'Borrar búsqueda', exact: true }).click()
  await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
  await expect.poll(async () => (await snapshot(page))?.shuffle).toBe(false)
  expect((await snapshot(page)).queue.map(entry => entry.source === 'youtube' ? entry.song.videoId : entry.trackId)).toEqual(songs.map(song => song.videoId))
})

test.describe('device downloads', () => {
  test.use({ serviceWorkers: 'allow' })

test('combines downloaded state with search, remembers it and offers a direct empty-state recovery', async ({ page, request }, info) => {
  for (const song of songs.slice(0, 2)) await request.put('/api/music/saved', { data: { song } })
  const snapshot = (await (await request.get('/api/library')).json()) as Library
  const asset = snapshot.tracks.find(track => track.title === 'Collection descargable')!
  expect((await request.post('/__test/youtube-local', { data: { videoId: songs[1]!.videoId, assetId: asset.original.id, duration: asset.duration } })).ok()).toBe(true)
  let playlist = await (await request.post('/api/playlists', { data: { name: 'Descargas de la colección' } })).json()
  playlist = await (await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: songs.slice(0, 2).map(song => `youtube:${song.videoId}`) } })).json()
  // Exercise a verified device download, including restoration through the service worker.
  await page.goto(`/playlist/${playlist.id}`)
  await expect(page.getByRole('textbox', { name: 'Filtrar canciones', exact: true })).toBeVisible()
  await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })) })
  await page.getByRole('button', { name: 'Opciones de Siénna', exact: true }).click()
  await page.getByRole('button', { name: 'Descargar en este dispositivo', exact: true }).click()
  await expect(page.getByLabel('Descargada en este dispositivo', { exact: true })).toHaveCount(1)
  await page.reload()
  const downloaded = page.getByRole('button', { name: 'Solo descargadas', exact: true })
  await downloaded.click()
  await expect(downloaded).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('listitem')).toContainText('Siénna')
  await page.reload()
  await expect(downloaded).toHaveAttribute('aria-pressed', 'true')
  const search = page.getByRole('textbox', { name: 'Filtrar canciones', exact: true })
  await search.fill('Horizonte')
  await expect(page.getByRole('heading', { name: 'No hay canciones descargadas que coincidan.', exact: true })).toBeVisible()
  await page.screenshot({ path: `output/playwright/collections/${info.project.name}-downloads-empty.png`, scale: 'css' })
  await page.getByRole('button', { name: 'Mostrar todas las canciones', exact: true }).click()
  await expect(downloaded).toHaveAttribute('aria-pressed', 'false')
  await expect(search).toHaveValue('Horizonte')
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await page.goto('/library')
  await expect(page.getByRole('button', { name: 'Reproducir esta colección en aleatorio', exact: true })).toBeVisible()
})

})
