import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { generateAudio } from '../helpers/audio'
import { lyricsSignature, parseLrc } from '../../shared/utils/lyrics'
import type { Library, PlaybackEntry, Track, YouTubeSong } from '../../shared/types/music'
import type { LyricsResult } from '../../shared/types/lyrics'
import { importButton } from '../helpers/ui'

let directory: string, first: Track, second: Track, audio: Buffer
const originalLyrics = '[00:00.00]Empieza el camino\n[00:05.00]La ciudad despierta\n[00:10.00]Seguimos adelante\n[00:18.00]\n[00:25.00]Volvemos a cantar'
const song: YouTubeSong = { videoId: 'abcdefghijk', title: 'Horizonte remoto', artists: ['Openfy'], album: 'Pruebas', artwork: null, duration: 99 }

async function importTrack(request: APIRequestContext, filename: string, frequency: number, lyrics: string) {
  const path = join(directory, filename)
  generateAudio(path, { format: 'aac', duration: 35, frequency, lyrics })
  const response = await request.post(`/api/imports?filename=${encodeURIComponent(filename)}`, { data: await readFile(path), headers: { 'Content-Type': 'application/octet-stream' } })
  expect(response.status()).toBe(202)
  const job = await response.json()
  await expect.poll(async () => (await (await request.get('/api/imports')).json()).find((item: { id: string }) => item.id === job.id)?.state).toMatch(/complete|duplicate/)
  const library = await (await request.get('/api/library')).json() as Library
  return library.tracks.find(track => track.title === filename.replace('.m4a', ''))!
}

async function playlist(request: APIRequestContext) {
  const collection = await (await request.post('/api/playlists', { data: { name: `Letras ${Date.now()}` } })).json()
  expect((await request.put(`/api/playlists/${collection.id}`, { data: { ...collection, trackIds: [first.id, second.id] } })).ok()).toBe(true)
  return `/playlist/${collection.id}`
}
async function boot(page: Page, path: string, offlineReady = false) {
  await page.goto(path)
  await expect(importButton(page)).toBeEnabled()
  if (offlineReady) await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
}
async function openLyrics(page: Page) {
  const button = page.getByRole('button', { name: 'Mostrar letras', exact: true })
  if (await button.isVisible()) await button.click()
  else {
    await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
  }
  return page.getByRole('region', { name: 'Letra de la canción', exact: true })
}
async function readyDownloads(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('openfy')
    open.onsuccess = () => {
      const db = open.result, query = db.transaction('downloads').objectStore('downloads').getAll()
      query.onsuccess = () => { resolve(query.result.filter((record: { state: string }) => record.state === 'ready').length); db.close() }
      query.onerror = () => reject(query.error)
    }
    open.onerror = () => reject(open.error)
  }))
}
function fixture(entry: PlaybackEntry, duration?: number, status: LyricsResult['status'] = 'synced'): LyricsResult {
  const track = entry.source === 'local' ? [first, second].find(track => track.id === entry.trackId) : undefined
  const text = entry.source === 'local' && entry.trackId === second.id ? '[00:00]Letra de otra canción\n[00:10]Un segundo verso' : originalLyrics
  const content = parseLrc(text)
  const now = Date.now()
  return { ...content, key: entry.source === 'local' ? entry.trackId : `youtube:${entry.song.videoId}`,
    signature: lyricsSignature(entry, track, duration), status, source: 'lrclib', attribution: 'Letras de prueba', sourceUrl: 'https://lrclib.net',
    lines: status === 'synced' ? content.lines : [], plainText: status === 'plain' || status === 'synced' ? content.plainText : '',
    fetchedAt: now, expiresAt: now + 86400000 }
}

test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-lyrics-e2e-'))
  first = await importTrack(request, 'Versos guardados.m4a', 314, originalLyrics)
  second = await importTrack(request, 'Otra letra.m4a', 412, '[00:00.00]Letra de otra canción\n[00:10.00]Un segundo verso')
  audio = await readFile(join(directory, 'Versos guardados.m4a'))
  expect((await request.post('/__test/youtube-audio', { data: audio })).ok()).toBe(true)
})
test.afterAll(async () => {
  if (!directory) return
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true)
  await rm(directory, { recursive: true, force: true })
})

test.describe('lyrics player', () => {
  test.use({ serviceWorkers: 'block' })

  test('validates input and keeps lyrics behind the existing private access middleware', async ({ request }) => {
    expect((await request.post('/api/lyrics/resolve', { data: { entry: { source: 'local', trackId: 'invalid' } } })).status()).toBe(400)
    expect((await request.post('/api/lyrics/resolve', { data: { entry: { source: 'youtube', song: { ...song, videoId: 'bad' } } } })).status()).toBe(400)
    expect((await request.post('/api/lyrics/resolve', { data: { entry: { source: 'youtube', song }, duration: -1 } })).status()).toBe(400)
    expect((await request.post('/api/lyrics/resolve', { data: { entry: { source: 'local', trackId: '00000000-0000-4000-8000-000000000000' } } })).status()).toBe(404)
    expect((await request.post('/api/lyrics/resolve', { headers: { 'Sec-Fetch-Site': 'cross-site' }, data: { entry: { source: 'local', trackId: first.id } } })).status()).toBe(403)
  })

  test('shows local lyrics, seeks by verse while paused and resumes automatic following', async ({ page, request }, info) => {
    await boot(page, await playlist(request))
    await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
    await page.getByRole('button', { name: 'Pausar', exact: true }).click()
    const panel = await openLyrics(page)
    await expect(panel.getByText('Empieza el camino', { exact: true })).toBeVisible()
    await expect(panel.getByText('Letra incluida en tu archivo', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Seguimos adelante · 0:10', exact: true }).click()
    await expect.poll(async () => page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(9.7)
    expect(await page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
    await expect(panel.getByRole('button', { name: 'Seguimos adelante · 0:10', exact: true })).toHaveAttribute('aria-current', 'true')
    await panel.getByRole('button', { name: 'Seguir reproducción', exact: true }).click()
    await panel.getByLabel('Versos de la canción').press('PageDown')
    await expect(panel.getByRole('button', { name: 'Seguir reproducción', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Seguir reproducción', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Seguir reproducción', exact: true })).toHaveCount(0)
    await page.screenshot({ path: `output/playwright/${info.project.name}-lyrics.png` })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const queue = page.getByRole('button', { name: 'Mostrar cola', exact: true })
    if (await queue.isVisible()) {
      await queue.click()
      await expect(page.getByRole('complementary', { name: 'Letras', exact: true })).toHaveCount(0)
    }
  })

  test('discards delayed responses after changing the current song', async ({ page, request }) => {
    let started = false
    await page.route('**/api/lyrics/resolve', async route => {
      const body = route.request().postDataJSON()
      if (body.entry.trackId === first.id) { started = true; await new Promise(resolve => setTimeout(resolve, 900)) }
      await route.fulfill({ json: fixture(body.entry, body.duration) }).catch(() => {})
    })
    await boot(page, await playlist(request))
    await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
    const panel = await openLyrics(page)
    await expect.poll(() => started).toBe(true)
    const next = page.getByRole('button', { name: 'Siguiente en reproductor ampliado', exact: true })
    if (await next.isVisible()) await next.click()
    else await page.getByRole('button', { name: 'Siguiente canción', exact: true }).click()
    await expect(panel.getByText('Letra de otra canción', { exact: true })).toBeVisible()
    await page.waitForTimeout(1100)
    await expect(panel.getByText('Empieza el camino', { exact: true })).toHaveCount(0)
  })

  test('keeps the latest lyric signature in IndexedDB when an older response arrives last', async ({ page, request }) => {
    await request.put('/__test/youtube-audio?status=200')
    await page.addInitScript(() => {
      const actual = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')!.get!
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return (window as any).__testDuration ?? actual.call(this) } })
      ;(window as any).__testDuration = 90
    })
    let release!: () => void, started = false
    const delayed = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/music/search?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('type') === 'artist' ? { artists: [], nextCursor: null } : { songs: [song], nextCursor: null } }))
    await page.route('**/api/lyrics/resolve', async route => {
      const body = route.request().postDataJSON()
      if (body.duration === 90) { started = true; await delayed }
      await route.fulfill({ json: fixture(body.entry, body.duration) }).catch(() => {})
    })
    await boot(page, '/search')
    await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('horizonte')
    await page.getByRole('button', { name: 'Reproducir Horizonte remoto', exact: true }).first().click()
    const panel = await openLyrics(page)
    await expect.poll(() => started).toBe(true)
    await page.evaluate(() => { (window as any).__testDuration = 35; document.querySelector('audio')!.dispatchEvent(new Event('durationchange')) })
    await expect(panel.getByText('Empieza el camino', { exact: true })).toBeVisible()
    release()
    await page.waitForTimeout(200)
    const duration = await page.evaluate(async () => new Promise<number>((resolve, reject) => {
      const opening = indexedDB.open('openfy')
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const db = opening.result
        const result = db.transaction('lyrics').objectStore('lyrics').get('youtube:abcdefghijk')
        result.onsuccess = () => { resolve(result.result.signature.duration); db.close() }
      }
    }))
    expect(duration).toBe(35)
  })

  test('uses the measured YouTube duration and retries transient failures', async ({ page, request }) => {
    await request.put('/__test/youtube-audio?status=200')
    let attempts = 0, measured = 0
    await page.route('**/api/music/search?*', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('type') === 'artist' ? { artists: [], nextCursor: null } : { songs: [song], nextCursor: null } }))
    await page.route('**/api/lyrics/resolve', async route => {
      const body = route.request().postDataJSON(); measured = body.duration
      if (attempts++ === 0) await route.fulfill({ status: 503, json: { message: 'Servicio temporalmente no disponible.' } })
      else await route.fulfill({ json: fixture(body.entry, body.duration) })
    })
    await boot(page, '/search')
    await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('horizonte')
    await page.getByRole('button', { name: 'Reproducir Horizonte remoto', exact: true }).first().click()
    await expect.poll(async () => page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.duration)).toBeLessThan(36)
    const panel = await openLyrics(page)
    await expect(panel.getByText('Servicio temporalmente no disponible.')).toBeVisible()
    await panel.getByRole('button', { name: 'Reintentar letras', exact: true }).click()
    await expect(panel.getByText('Empieza el camino', { exact: true })).toBeVisible()
    expect(measured).toBeGreaterThan(34); expect(measured).toBeLessThan(36)
  })

  for (const status of ['plain', 'instrumental', 'not_found'] as const) {
    test(`shows ${status} without clickable timestamps`, async ({ page, request }) => {
      await page.route('**/api/lyrics/resolve', route => {
        const body = route.request().postDataJSON()
        return route.fulfill({ json: fixture(body.entry, body.duration, status) })
      })
      await boot(page, await playlist(request))
      await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
      const panel = await openLyrics(page)
      const text = status === 'plain' ? 'Letra sin sincronización' : status === 'instrumental' ? 'Esta canción es instrumental.' : 'No encontramos letras para esta canción.'
      await expect(panel.getByText(text, { exact: true })).toBeVisible()
      await expect(panel.locator('.lyrics-line')).toHaveCount(0)
    })
  }
})

test.describe('offline lyrics', () => {
  test('upgrades IndexedDB v1 without losing snapshots, events or an existing download', async ({ page }) => {
    await page.route('**/__migration', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Migration fixture</title>' }))
    await page.goto('/__migration')
    const seeded = await page.evaluate(async track => {
      // Model an existing installed PWA: register its worker before seeding
      // the legacy database and downloaded audio in the same worker lifecycle.
      await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
      const asset = track.mobile!
      const response = await fetch(`/api/assets/${asset.id}`)
      if (!response.ok) throw new Error(`Could not seed audio: ${response.status}`)
      // Match the persisted response shape of a verified download, without HTTP cache metadata.
      await (await caches.open('openfy-audio-v1')).put(`/api/assets/${asset.id}`, new Response(await response.arrayBuffer(), {
        headers: { 'Content-Type': asset.mime, 'Content-Length': String(asset.bytes), 'Accept-Ranges': 'bytes' },
      }))
      await new Promise<void>((resolve, reject) => {
        // Dexie maps schema version 1 to native IndexedDB version 10.
        const open = indexedDB.open('openfy', 10)
        open.onupgradeneeded = () => {
          const db = open.result
          db.createObjectStore('snapshots', { keyPath: 'key' })
          db.createObjectStore('downloads', { keyPath: 'trackId' })
          db.createObjectStore('events', { keyPath: 'id', autoIncrement: true }).createIndex('at', 'at')
        }
        open.onsuccess = () => {
          const db = open.result, transaction = db.transaction(['snapshots', 'downloads', 'events'], 'readwrite')
          transaction.objectStore('snapshots').put({ key: 'migration-check', value: 'conservado' })
          transaction.objectStore('downloads').put({ trackId: track.id, assetId: asset.id, state: 'ready', bytes: asset.bytes, total: asset.bytes, updatedAt: Date.now(), error: null })
          transaction.objectStore('events').put({ at: 1, type: 'migration-check', trackId: track.id, position: 0, visibility: 'visible' })
          transaction.oncomplete = () => { db.close(); resolve() }; transaction.onerror = () => reject(transaction.error)
        }
        open.onerror = () => reject(open.error)
      })
      return (await (await caches.open('openfy-audio-v1')).keys()).map(key => key.url)
    }, first)
    await page.unroute('**/__migration')
    await boot(page, '/downloads', true)
    expect(await page.evaluate(async () => (await (await caches.open('openfy-audio-v1')).keys()).map(key => key.url))).toEqual(seeded)
    await expect.poll(() => readyDownloads(page)).toBe(1)
    const saved = await page.evaluate(() => new Promise<{ version: number; snapshot: string; event: boolean; lyricsStore: boolean; listeningStore: boolean }>((resolve, reject) => {
      const open = indexedDB.open('openfy')
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(['snapshots', 'events'])
        const snapshot = tx.objectStore('snapshots').get('migration-check'), events = tx.objectStore('events').getAll()
        tx.oncomplete = () => {
          resolve({ version: db.version, snapshot: snapshot.result.value, event: events.result.some(event => event.type === 'migration-check'), lyricsStore: db.objectStoreNames.contains('lyrics'), listeningStore: db.objectStoreNames.contains('listening') }); db.close()
        }
      }
      open.onerror = () => reject(open.error)
    }))
    expect(saved).toEqual({ version: 40, snapshot: 'conservado', event: true, lyricsStore: true, listeningStore: true })
  })

  test('fetches lyrics with downloads and reopens them with the audio offline', async ({ page, request, context }) => {
    const collectionPath = await playlist(request)
    await boot(page, collectionPath, true)
    await page.getByRole('button', { name: 'Descargar esta colección', exact: true }).click()
    await expect.poll(async () => page.evaluate(() => new Promise<number>((resolve, reject) => {
      const open = indexedDB.open('openfy')
      open.onsuccess = () => {
        const db = open.result, query = db.transaction('lyrics').objectStore('lyrics').getAll()
        query.onsuccess = () => { resolve(query.result.length); db.close() }; query.onerror = () => reject(query.error)
      }
      open.onerror = () => reject(open.error)
    }))).toBe(2)
    await page.goto('/downloads')
    await expect(page.getByRole('heading', { name: '2 canciones descargadas', exact: true })).toBeVisible()
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.goto(collectionPath)
    await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
    const panel = await openLyrics(page)
    await expect(panel.getByText('Empieza el camino', { exact: true })).toBeVisible()
    await expect(panel.getByText('Sin conexión', { exact: true })).toBeVisible()
    await expect.poll(async () => page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(.2)
  })

  test('keeps downloaded audio usable when fetching lyrics fails', async ({ page, request, context }) => {
    const collectionPath = await playlist(request)
    await page.addInitScript(() => {
      const original = window.fetch.bind(window)
      window.fetch = (input, options) => String(input).includes('/api/lyrics/resolve')
        ? Promise.resolve(Response.json({ message: 'Letras temporalmente no disponibles.' }, { status: 503 })) : original(input, options)
    })
    await boot(page, collectionPath, true)
    await page.getByRole('button', { name: 'Descargar esta colección', exact: true }).click()
    await expect.poll(() => readyDownloads(page)).toBe(2)
    await page.goto('/downloads')
    await expect(page.getByRole('heading', { name: '2 canciones descargadas', exact: true })).toBeVisible()
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.goto(collectionPath)
    await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
    const panel = await openLyrics(page)
    await expect(panel.getByText('La letra no está guardada en este dispositivo.', { exact: true })).toBeVisible()
    await expect.poll(async () => page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(.2)
  })
})
