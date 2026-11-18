import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { generateAudio } from '../helpers/audio'
import type { Library, Track, YouTubeSong } from '../../shared/types/music'

test.use({ serviceWorkers: 'block' })
let directory: string, track: Track
const song: YouTubeSong = { videoId: 'Te1emetry01', title: 'Sienna de prueba', artists: ['Artista de telemetría'], album: 'Biblioteca mixta', genres: ['Alternativo'], duration: 100, artwork: null }
test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-listening-e2e-'))
  const path = join(directory, 'Escucha medible.m4a')
  generateAudio(path, { duration: 8, format: 'aac', frequency: 421 })
  expect((await request.post('/__test/youtube-audio', { data: await readFile(path) })).ok()).toBe(true)
  const imported = await request.post('/api/imports?filename=Escucha%20medible.m4a', { data: await readFile(path), headers: { 'Content-Type': 'application/octet-stream' } })
  expect(imported.status()).toBe(202)
  await expect.poll(async () => (await (await request.get('/api/library')).json() as Library).tracks.some(item => item.title === 'Escucha medible')).toBe(true)
  track = (await (await request.get('/api/library')).json() as Library).tracks.find(item => item.title === 'Escucha medible')!
  expect((await request.put('/api/music/saved', { data: { song } })).ok()).toBe(true)
})
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }) })
async function openTrack(page: Page) {
  await page.goto('/library')
  await page.getByRole('textbox', { name: 'Filtrar canciones', exact: true }).fill(track.title)
  await page.getByRole('button', { name: `Reproducir ${track.title}`, exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(audio => !(audio as HTMLAudioElement).paused && (audio as HTMLAudioElement).currentTime > .1)).toBe(true)
}
async function pendingCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('openfy')
    open.onsuccess = () => { const db = open.result; const count = db.transaction('listening').objectStore('listening').count(); count.onsuccess = () => { resolve(count.result); db.close() }; count.onerror = () => reject(count.error) }
    open.onerror = () => reject(open.error)
  }))
}
test('persists actual listening through failed synchronization and reopens without duplicate plays', async ({ page, request }) => {
  const before = (await (await request.get('/api/telemetry/stats?period=all')).json()).byTrack[track.id]?.plays || 0
  await page.route('**/api/telemetry/listening', route => route.fulfill({ status: 503, json: { message: 'PC no disponible' } }))
  await openTrack(page)
  await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).ended), { timeout: 15000 }).toBe(true)
  await expect.poll(() => pendingCount(page)).toBeGreaterThan(0)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Filtrar canciones', exact: true })).toHaveValue(track.title)
  expect(await pendingCount(page)).toBeGreaterThan(0)
  await page.unroute('**/api/telemetry/listening')
  await page.reload()
  await expect.poll(async () => (await (await request.get('/api/telemetry/stats?period=all')).json()).byTrack[track.id]?.plays).toBe(before + 1)
  await expect.poll(() => pendingCount(page)).toBe(0)
  await page.reload()
  expect((await (await request.get('/api/telemetry/stats?period=all')).json()).byTrack[track.id].plays).toBe(before + 1)
})
test('searches a mixed collection, migrates per-view filters and preserves saved playlist order', async ({ page, request }) => {
  const playlist = await (await request.post('/api/playlists', { data: { name: 'Filtros medibles' } })).json()
  const ordered = [track.id, `youtube:${song.videoId}`]
  await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: ordered } })
  await page.addInitScript(({ id, title }) => {
    const key = `openfy-filters:/playlist/${id}`
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ query: title, genre: 'Rock', artist: 'Artista anterior', source: 'local', favorite: true }))
  }, { id: playlist.id, title: song.title })
  await page.goto(`/playlist/${playlist.id}`)
  const search = page.getByRole('textbox', { name: 'Filtrar canciones', exact: true })
  await expect(search).toHaveValue(song.title)
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('combobox', { name: 'Filtrar por origen', exact: true })).toHaveCount(0)
  await expect(page.getByText('Solo favoritas', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(search).toHaveValue(song.title)
  expect((await (await request.get('/api/library')).json() as Library).playlists.find(item => item.id === playlist.id)?.trackIds).toEqual(ordered)
  await page.getByRole('button', { name: 'Borrar búsqueda', exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await search.fill(song.title)
  await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open('openfy'); open.onsuccess = () => { const db = open.result; const get = db.transaction('snapshots').objectStore('snapshots').get('playback'); get.onsuccess = () => { resolve((get.result?.value?.queue || []).map((item: { source: string }) => item.source)); db.close() }; get.onerror = () => reject(get.error) }; open.onerror = () => reject(open.error)
  }))).toEqual(['youtube'])
})

test('shows the period ranking and accepts an idempotent qualified play', async ({ page, request }) => {
  const startedAt = Date.now() - 120000
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(startedAt)
  const snapshot = { id: randomUUID(), deviceId: randomUUID(), sequence: 1, entry: { source: 'youtube', song }, startedAt, updatedAt: startedAt + 90000, durationMs: 100000, listenedMs: 90000, days: { [day]: 90000 }, qualifiedAt: startedAt + 90000 }
  const before = (await (await request.get('/api/telemetry/stats?period=all')).json()).byTrack[`youtube:${song.videoId}`]?.plays || 0
  expect((await request.post('/api/telemetry/listening', { data: { sessions: [snapshot] } })).ok()).toBe(true)
  expect((await request.post('/api/telemetry/listening', { data: { sessions: [snapshot] } })).ok()).toBe(true)
  expect((await (await request.get('/api/telemetry/stats?period=all')).json()).byTrack[`youtube:${song.videoId}`].plays).toBe(before + 1)
  await page.goto('/most-played')
  await expect(page.getByRole('heading', { name: 'Tus más reproducidas', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Filtrar canciones', exact: true }).fill(song.title)
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Período del ranking', exact: true }).selectOption('all')
  await expect(page.getByRole('listitem')).toContainText(song.title)
  await expect(page.getByRole('listitem').getByLabel(`${before + 1} reproducciones`, { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
