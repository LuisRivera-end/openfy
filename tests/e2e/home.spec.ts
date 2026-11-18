import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAudio } from '../helpers/audio'
import type { Library, LibraryItem, PlaybackSnapshotV3, YouTubeSong } from '../../shared/types/music'

test.use({ serviceWorkers: 'block' })
const songs: YouTubeSong[] = Array.from({ length: 12 }, (_, i) => ({
  videoId: i === 0 ? 'abcdefghijk' : i === 1 ? '12345678901' : `home${String(i).padStart(7, '0')}`,
  title: ['Horizonte', 'Luz de noviembre', 'Volver a casa', 'Mar abierto'][i % 4] + (i > 3 ? ` ${i}` : ''),
  artists: [`Artista ${i + 1}`], album: `Álbum ${i + 1}`, duration: 100,
  artwork: `https://home-fixture.invalid/${i}.png`,
}))
const savedSongs = songs.map((song, i) => ({ ...song, videoId: `saved${String(i).padStart(6, '0')}`, title: `Guardada ${i + 1}`, artists: [`Biblioteca ${i + 1}`] }))
const library: Library = { tracks: [], youtubeSongs: savedSongs.map((song, i) => ({ song, favorite: i < 3, addedAt: 1000 + i })), playlists: [{ id: 'home-playlist', name: 'Para el camino', trackIds: savedSongs.map(song => `youtube:${song.videoId}`), revision: 1, updatedAt: 1000 }] }
const items: LibraryItem[] = savedSongs.map(song => ({ id: `youtube:${song.videoId}`, source: 'youtube', title: song.title, artist: song.artists.join(', '), album: song.album!, duration: song.duration!, artwork: song.artwork, palette: [], favorite: false, format: 'YouTube Music', genres: [], entry: { source: 'youtube', song } }))
let directory: string
test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-home-'))
  const path = join(directory, 'home.m4a'); generateAudio(path, { duration: 8, format: 'aac', frequency: 421 })
  await request.post('/__test/youtube-audio', { data: await readFile(path) })
})
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

async function mockHome(page: Page, empty = false) {
  await page.route('**/api/library', route => route.fulfill({ json: empty ? { tracks: [], youtubeSongs: [], playlists: [] } : library }))
  await page.route('**/api/music/recommendations**', route => route.fulfill({ json: { songs: empty ? [] : songs, releases: empty ? [] : [{ id: 'MPREb_homefresh', title: 'Un lanzamiento nuevo', artists: [{ id: null, name: 'Artista nuevo' }], artwork: songs[0]!.artwork, year: new Date().getFullYear() }], algorithmVersion: 2, generatedAt: Date.now(), stale: false, error: null } }))
  // Specs share the e2e server; another spec may already have listened to these IDs, and heard songs are not suggested.
  await page.route('**/api/telemetry/stats**', async route => {
    const response = await route.fetch(), stats = await response.json()
    for (const song of songs) delete stats.byTrack?.[`youtube:${song.videoId}`]
    return route.fulfill({ response, json: stats })
  })
  await page.route('**/api/telemetry/recent**', route => route.fulfill({ json: { items: empty ? [] : [
    ...items.slice(0, 10).map((item, i) => ({ kind: 'song', key: `song:${item.id}`, id: item.id, title: item.title, subtitle: item.artist, artwork: item.artwork, item, lastPlayedAt: 10000 - i })),
    { kind: 'playlist', key: 'playlist:home-playlist', id: 'home-playlist', title: 'Para correr', subtitle: 'Playlist', artwork: null, item: null, lastPlayedAt: 9980 },
    { kind: 'album', key: 'album:youtube:MPRE1', id: 'youtube:MPRE1', title: 'Álbum reciente', subtitle: 'Openfy', artwork: null, item: null, lastPlayedAt: 9979 },
  ] } }))
  await page.route('**/api/artwork/**', route => {
    const colors = ['#165d78', '#a84c40', '#425b39', '#685092']
    const url = new URL(route.request().url()).searchParams.get('url') || ''
    const index = Number(url.match(/\/(\d+)\.png/)?.[1] || 0)
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${colors[index % 4]}"/><circle cx="256" cy="220" r="150" fill="#ffffff15"/><path d="M0 470 250 180 512 470" fill="#0003"/><text x="32" y="75" font-family="sans-serif" font-size="32" fill="white">${songs[index]?.album || 'Openfy'}</text></svg>` })
  })
}

test('uses real collection state and browsable cover shelves on desktop and mobile', async ({ page }, info) => {
  await mockHome(page); await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible()
  const suggestions = page.getByRole('region', { name: 'Sugerencias para ti', exact: true })
  await expect(suggestions.locator('.home-song')).toHaveCount(12)
  await expect(page.getByRole('heading', { name: 'Escuchado recientemente', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tus favoritas y playlists', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: `Lanzamientos de ${new Date().getFullYear()}`, exact: true })).toBeVisible()
  await expect(page.getByText('Dale play a tu', { exact: false })).toHaveCount(0)
  await expect(page.getByText('minutos escuchados', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await suggestions.getByRole('button', { name: 'Reproducir Horizonte', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(suggestions.getByRole('button', { name: 'Reproducir Luz de noviembre', exact: true })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(suggestions.getByRole('button', { name: 'Reproducir Horizonte', exact: true })).toBeFocused()
  await page.screenshot({ path: `output/playwright/${info.project.name}-music-home.png`, fullPage: true })
  // Touch screens swipe the shelves; the arrows are only for pointers that can hover.
  if (await page.evaluate(() => matchMedia('(hover: none)').matches)) {
    await expect(suggestions.getByRole('button', { name: 'Siguiente en Sugerencias para ti', exact: true })).toBeHidden()
    await suggestions.locator('.home-rail').evaluate(el => el.scrollBy({ left: 300, behavior: 'instant' }))
  } else await suggestions.getByRole('button', { name: 'Siguiente en Sugerencias para ti', exact: true }).click()
  await expect.poll(() => suggestions.locator('.home-rail').evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  const collections = page.getByRole('region', { name: 'Tus favoritas y playlists', exact: true })
  await collections.getByRole('link').filter({ hasText: 'Para el camino' }).click()
  await expect(page.getByRole('heading', { name: 'Para el camino', exact: true })).toBeVisible()
})

test('plays a suggestion with its row as queue and supports the song menu', async ({ page }) => {
  await mockHome(page); await page.goto('/')
  const suggestions = page.getByRole('region', { name: 'Sugerencias para ti', exact: true })
  await suggestions.getByRole('button', { name: 'Reproducir Horizonte', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(el => !(el as HTMLAudioElement).paused && (el as HTMLAudioElement).currentTime > .1)).toBe(true)
  await suggestions.getByRole('button', { name: 'Opciones de Horizonte', exact: true }).click()
  await page.getByRole('button', { name: 'Añadir a la cola', exact: true }).click()
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('openfy'); open.onsuccess = () => { const db = open.result; const get = db.transaction('snapshots').objectStore('snapshots').get('playback'); get.onsuccess = () => { resolve(get.result?.value?.queue?.length || 0); db.close() }; get.onerror = () => reject(get.error) }; open.onerror = () => reject(open.error)
  }))).toBe(13)
})

test('retains cached suggestions on refresh failure and cached collection after disconnect', async ({ page }) => {
  await mockHome(page); await page.goto('/')
  const suggestions = page.getByRole('region', { name: 'Sugerencias para ti', exact: true })
  await expect(suggestions.locator('.home-song')).toHaveCount(12)
  await page.route('**/api/music/recommendations**', route => route.fulfill({ status: 503, json: { message: 'Sin conexión' } }))
  await suggestions.getByRole('button', { name: 'Actualizar', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'No se pudieron actualizar las sugerencias' })).toBeVisible()
  await expect(suggestions.locator('.home-song')).toHaveCount(12)
  await page.route('**/api/library', route => route.fulfill({ status: 503 }))
  await page.route('**/api/telemetry/recent**', route => route.fulfill({ status: 503 }))
  await page.reload()
  await expect(page.getByRole('region', { name: 'Escuchado recientemente', exact: true }).locator('.home-song')).toHaveCount(10)
  await expect(page.getByRole('region', { name: 'Sugerencias para ti', exact: true }).locator('.home-song')).toHaveCount(12)
})

async function playback(page: Page) {
  return page.evaluate(() => new Promise<PlaybackSnapshotV3>((resolve, reject) => {
    const open = indexedDB.open('openfy'); open.onerror = () => reject(open.error)
    open.onsuccess = () => { const db = open.result; const get = db.transaction('snapshots').objectStore('snapshots').get('playback'); get.onsuccess = () => { resolve(get.result?.value); db.close() }; get.onerror = () => reject(get.error) }
  }))
}

test('shows recent collections as links and plays only recent songs with their origin', async ({ page }) => {
  await mockHome(page); await page.goto('/')
  const recent = page.getByRole('region', { name: 'Escuchado recientemente', exact: true })
  await expect(recent.locator('.home-song')).toHaveCount(10)
  await expect(recent.getByRole('link', { name: 'Para correr Playlist', exact: true })).toHaveAttribute('href', '/playlist/home-playlist')
  await expect(recent.getByRole('link', { name: 'Álbum reciente Openfy', exact: true })).toHaveAttribute('href', '/music/album/MPRE1')
  await recent.getByRole('button', { name: `Reproducir ${items[0]!.title}`, exact: true }).click()
  await expect.poll(async () => (await playback(page))?.queue.length).toBe(10)
  expect((await playback(page)).queue.every(entry => entry.context?.kind === 'song')).toBe(true)
  await recent.getByRole('button', { name: `Opciones de ${items[0]!.title}`, exact: true }).click()
  await page.getByRole('button', { name: 'Añadir a la cola', exact: true }).click()
  await expect.poll(async () => (await playback(page))?.queue.length).toBe(11)
  expect((await playback(page)).queue[10]?.context).toEqual({ kind: 'song' })
})

test('ignores an old recent cache when the server is unavailable', async ({ page }) => {
  await mockHome(page); await page.goto('/')
  await expect(page.getByRole('region', { name: 'Escuchado recientemente', exact: true })).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('openfy'); open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots')
      store.delete('listening-recent-v2'); store.put({ key: 'listening-recent', value: { items: [{ item: { id: 'old-format' } }] } })
      tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error)
    }
  }))
  await page.route('**/api/telemetry/recent**', route => route.fulfill({ status: 503 }))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Sugerencias para ti', exact: true }).locator('.home-song')).toHaveCount(12)
  await expect(page.getByRole('region', { name: 'Escuchado recientemente', exact: true })).toHaveCount(0)
})

test('offers a compact, actionable empty state', async ({ page }, info) => {
  await mockHome(page, true); await page.goto('/')
  await expect(page.getByRole('heading', { name: '¿Qué quieres escuchar?', exact: true })).toBeVisible()
  await expect(page.locator('.home-welcome').getByRole('link', { name: 'Buscar música', exact: true })).toBeVisible()
  await expect(page.locator('.home-welcome').getByRole('button', { name: 'Importar música', exact: true })).toBeVisible()
  await expect(page.locator('.home-placeholder')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `output/playwright/${info.project.name}-music-home-empty.png`, fullPage: true })
})

test('validates the recent endpoint limit', async ({ request }) => {
  for (const limit of ['0', '25', '1.5', 'oops']) expect((await request.get(`/api/telemetry/recent?limit=${limit}`)).status()).toBe(400)
  expect((await request.get('/api/telemetry/recent?limit=1')).ok()).toBe(true)
})
