import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAudio } from '../helpers/audio'
import type { Library, Track } from '../../shared/types/music'
import { importButton, isPhone } from '../helpers/ui'

let directory: string
let first: Track, second: Track, brief: Track

async function seed(request: APIRequestContext, path: string, name: string) {
  const response = await request.post(`/api/imports?filename=${encodeURIComponent(name)}`, {
    data: await readFile(path), headers: { 'Content-Type': 'application/octet-stream' },
  })
  expect(response.status()).toBe(202)
  const job = await response.json()
  await expect.poll(async () => (await (await request.get('/api/imports')).json()).find((j: { id: string }) => j.id === job.id)?.state,
    { timeout: 20000 }).toMatch(/complete|duplicate/)
}

async function boot(page: Page, path = '/') {
  await page.goto(path)
  await expect(importButton(page)).toBeEnabled()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
}

async function collection(request: APIRequestContext, ids: string[]) {
  const playlist = await (await request.post('/api/playlists', { data: { name: `Sesión ${Date.now()}` } })).json()
  const response = await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: ids } })
  expect(response.ok()).toBe(true)
  return playlist.id as string
}

async function localRecords(page: Page) {
  return page.evaluate(() => new Promise<Array<{ state: string; error: string | null }>>((resolve, reject) => {
    const open = indexedDB.open('openfy')
    open.onsuccess = () => {
      const db = open.result
      const query = db.transaction('downloads').objectStore('downloads').getAll()
      query.onsuccess = () => { resolve(query.result); db.close() }
      query.onerror = () => reject(query.error)
    }
    open.onerror = () => reject(open.error)
  }))
}

test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-browser-'))
  for (const [name, frequency, duration] of [['Prueba A', 220, 35], ['Prueba B', 330, 35], ['Prueba breve', 440, 1.2]] as const) {
    const path = join(directory, `${name}.mp3`)
    generateAudio(path, { frequency, duration })
    await seed(request, path, `${name}.mp3`)
  }
  const library = await (await request.get('/api/library')).json() as Library
  first = library.tracks.find(track => track.title === 'Prueba A')!
  second = library.tracks.find(track => track.title === 'Prueba B')!
  brief = library.tracks.find(track => track.title === 'Prueba breve')!
})
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

test('imports files from the UI and searches the resulting library', async ({ page, request }) => {
  const existing = (await (await request.get('/api/library')).json() as Library).tracks.find(t => t.title === 'Desde el PC')
  if (existing) await request.put(`/api/tracks/${existing.id}/favorite`, { data: { favorite: false } })
  await boot(page, '/library')
  const file = join(directory, 'Desde el PC.mp3')
  generateAudio(file, { frequency: 510, duration: 2 })
  await page.getByTestId('file-input').setInputFiles(file)
  await expect(page.getByRole('button', { name: 'Reproducir Desde el PC', exact: true })).toBeVisible({ timeout: 20000 })
  await page.getByRole('textbox', { name: 'Filtrar canciones' }).fill('desde el pc')
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: 'Opciones de Desde el PC', exact: true }).click()
  await page.getByRole('button', { name: 'Añadir a favoritos', exact: true }).click()
  await expect.poll(async () => (await (await request.get('/api/library')).json() as Library).tracks.find(track => track.title === 'Desde el PC')?.favorite).toBe(true)
  await page.goto('/favorites')
  await expect(page.getByRole('button', { name: 'Reproducir Desde el PC', exact: true })).toBeVisible()
})

test('creates and edits a playlist and detects stale concurrent edits', async ({ page, request }, info) => {
  await boot(page, '/library')
  await page.getByRole('main').getByRole('button', { name: 'Crear playlist', exact: true }).click()
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Mi playlist de prueba')
  await page.getByRole('dialog').getByRole('button', { name: 'Crear playlist', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mi playlist de prueba', exact: true })).toBeVisible()
  const id = page.url().split('/').pop()!
  const library = await (await request.get('/api/library')).json() as Library
  const playlist = library.playlists.find(p => p.id === id)!
  const update = await request.put(`/api/playlists/${id}`, { data: { ...playlist, trackIds: [first.id] } })
  expect(update.status()).toBe(200)
  const conflict = await request.put(`/api/playlists/${id}`, { data: { ...playlist, trackIds: [second.id] } })
  expect(conflict.status()).toBe(409)
  await page.reload()
  await expect(page.getByRole('button', { name: `Reproducir ${first.title}`, exact: true })).toBeVisible()
  // Phones keep rename and delete in the playlist's options sheet.
  if (isPhone(info)) await page.getByRole('button', { name: 'Opciones de la playlist', exact: true }).click()
  await page.getByRole('button', { name: 'Editar nombre', exact: true }).click()
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Gym')
  await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Gym', exact: true })).toBeVisible()
})

test('serves full files, HEAD, suffix ranges and invalid ranges correctly', async ({ request }) => {
  const path = `/api/assets/${first.original.id}`
  const full = await request.get(path)
  const bytes = await full.body()
  expect(full.status()).toBe(200)
  expect(bytes.length).toBe(first.original.bytes)
  const head = await request.head(path)
  expect(head.headers()['content-length']).toBe(String(bytes.length))
  expect(await head.body()).toHaveLength(0)
  const partial = await request.get(path, { headers: { Range: 'bytes=10-29' } })
  expect(partial.status()).toBe(206)
  expect(await partial.body()).toEqual(bytes.subarray(10, 30))
  const suffix = await request.get(path, { headers: { Range: 'bytes=-15' } })
  expect(await suffix.body()).toEqual(bytes.subarray(-15))
  expect((await request.get(path, { headers: { Range: 'bytes=999999999-' } })).status()).toBe(416)
  expect((await request.post(path)).status()).toBe(405)
  expect((await request.get('/api/assets/missing')).status()).toBe(404)
  expect((await request.post('/api/playlists', { data: { name: 'No' }, headers: { Origin: 'https://other.example' } })).status()).toBe(403)
  // Emulate a private reverse proxy that rewrites Host to 127.0.0.1.
  expect((await request.post('/api/playlists', { data: { name: 'Origen privado' }, headers: { Origin: 'https://openfy-test.example' } })).status()).toBe(201)
})

test('streaming alone never creates an offline download', async ({ page }) => {
  await boot(page)
  const result = await page.evaluate(async id => {
    await fetch(`/api/assets/${id}`, { headers: { Range: 'bytes=0-100' } })
    return !!await (await caches.open('openfy-audio-v1')).match(`/api/assets/${id}`)
  }, first.original.id)
  expect(result).toBe(false)
  expect(await localRecords(page)).toHaveLength(0)
})

test('downloads, verifies, reopens offline, seeks and removes local audio', async ({ page, request, context }, info) => {
  const id = await collection(request, [first.id, second.id, brief.id])
  await boot(page, `/playlist/${id}`)
  await page.getByRole('button', { name: 'Descargar esta colección', exact: true }).click()
  await expect.poll(async () => (await localRecords(page)).filter(r => r.state === 'ready').length).toBe(3)
  await page.goto('/downloads')
  await expect(page.getByRole('heading', { name: '3 canciones descargadas' })).toBeVisible()
  await page.screenshot({ path: `output/playwright/${info.project.name}-downloads.png`, fullPage: true })
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '3 canciones descargadas' })).toBeVisible()
  const range = await page.evaluate(async id => {
    const response = await fetch(`/api/assets/${id}`, { headers: { Range: 'bytes=100-163' } })
    return { status: response.status, bytes: (await response.arrayBuffer()).byteLength }
  }, first.mobile!.id)
  expect(range).toEqual({ status: 206, bytes: 64 })
  await page.goto(`/playlist/${id}`)
  await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible().catch(async error => {
    console.log('Media diagnostics:', await page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => ({
      readyState: audio.readyState, networkState: audio.networkState, paused: audio.paused, error: audio.error?.code,
      mp3: audio.canPlayType('audio/mpeg'), aac: audio.canPlayType('audio/mp4'), src: audio.currentSrc,
    })))
    throw error
  })
  await expect.poll(async () => page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.5)
  await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Reproductor ampliado' })).toBeVisible()
  await page.getByRole('slider', { name: 'Posición en reproductor ampliado' }).evaluate((element: HTMLInputElement) => {
    element.value = '10'; element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Posición en reproductor ampliado' }).inputValue())).toBeGreaterThanOrEqual(10)
  await page.screenshot({ path: `output/playwright/${info.project.name}-player.png` })
  await page.getByRole('button', { name: 'Cerrar reproductor ampliado' }).click()
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await page.goto('/downloads')
  const remove = page.getByRole('button', { name: 'Eliminar descarga de este dispositivo' })
  await remove.nth(0).click()
  await page.getByRole('dialog', { name: 'Eliminar descarga' }).getByRole('button', { name: 'Eliminar descarga', exact: true }).click()
  await expect(page.getByRole('heading', { name: '2 canciones descargadas' })).toBeVisible()
  const original = await request.get(`/api/assets/${first.original.id}`)
  expect(original.status()).toBe(200)
})

test('advances automatically and keeps the same audio session across routes', async ({ page, request }) => {
  const id = await collection(request, [brief.id, first.id, second.id])
  await boot(page, `/playlist/${id}`)
  await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Abrir reproductor ampliado' })).toContainText(first.title, { timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  const before = await page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.currentTime)
  // Client navigation, unlike a full page load, must retain the singleton Audio.
  await page.getByRole('link', { name: 'Abrir ajustes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ajustes', exact: true })).toBeVisible()
  await expect.poll(async () => page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(before)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
})

test('rejects an incomplete download without marking it ready', async ({ page, request }) => {
  const id = await collection(request, [first.id])
  await boot(page, `/playlist/${id}`)
  await page.evaluate(() => {
    const fetchOriginal = window.fetch.bind(window)
    window.fetch = (input, options) => String(input).includes('/api/assets/')
      ? Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }))
      : fetchOriginal(input, options)
  })
  await page.getByRole('button', { name: 'Descargar esta colección' }).click()
  await expect.poll(async () => (await localRecords(page))[0]?.state).toBe('error')
  expect(await page.evaluate(async id => !!await (await caches.open('openfy-audio-v1')).match(`/api/assets/${id}`), first.mobile!.id)).toBe(false)
})

test('reports insufficient storage without deleting existing downloads', async ({ page, request }) => {
  const existingId = await collection(request, [first.id])
  await boot(page, `/playlist/${existingId}`)
  await page.getByRole('button', { name: 'Descargar esta colección' }).click()
  await expect.poll(async () => (await localRecords(page)).filter(r => r.state === 'ready').length).toBe(1)
  const id = await collection(request, [second.id])
  await page.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator.storage), 'estimate', { value: async () => ({ usage: 0, quota: 1 }) })
  })
  await boot(page, `/playlist/${id}`)
  expect((await page.evaluate(() => navigator.storage.estimate())).quota).toBe(1)
  await page.getByRole('button', { name: 'Descargar esta colección' }).click()
  await expect.poll(async () => (await localRecords(page)).filter(r => r.state === 'error').length).toBe(1).catch(async error => {
    console.log('Storage diagnostics:', await localRecords(page), await page.evaluate(() => navigator.storage.estimate()))
    throw error
  })
  expect((await localRecords(page)).find(r => r.state === 'error')?.error).toContain('espacio')
  expect((await localRecords(page)).filter(r => r.state === 'ready')).toHaveLength(1)
  expect(await page.evaluate(async id => !!await (await caches.open('openfy-audio-v1')).match(`/api/assets/${id}`), first.mobile!.id)).toBe(true)
})

test('lays out home and library without horizontal overflow', async ({ page }, info) => {
  await boot(page)
  await page.screenshot({ path: `output/playwright/${info.project.name}-home.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto('/library')
  await expect(page.getByRole('button', { name: `Reproducir ${first.title}`, exact: true })).toBeVisible()
  await page.screenshot({ path: `output/playwright/${info.project.name}-library.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('restores the queue and position after reopening without autoplay', async ({ page, request }) => {
  const id = await collection(request, [first.id, second.id])
  await boot(page, `/playlist/${id}`)
  await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Abrir reproductor ampliado' }).click()
  await page.getByRole('slider', { name: 'Posición en reproductor ampliado' }).evaluate((element: HTMLInputElement) => {
    element.value = '8'; element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'Pausar en reproductor ampliado' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Abrir reproductor ampliado' })).toContainText(first.title)
  await expect.poll(async () => page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(7.5).catch(async error => {
    console.log('Restore diagnostics:', JSON.stringify(await page.getByTestId('audio-engine').evaluate(async (audio: HTMLAudioElement) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('openfy'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error) })
      const read = (table: string) => new Promise<unknown>((resolve, reject) => { const request = database.transaction(table).objectStore(table).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const snapshots = (await read('snapshots') as Array<{ key: string; value: unknown }>).filter(row => row.key === 'playback')
      const events = (await read('events') as unknown[]).slice(-12)
      database.close()
      return { time: audio.currentTime, ready: audio.readyState, seeking: audio.seeking, duration: audio.duration, error: audio.error?.code, snapshots, events }
    })))
    throw error
  })
  expect(await page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
})
