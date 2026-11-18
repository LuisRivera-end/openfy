import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { generateAudio } from '../helpers/audio'
import type { YouTubeAlbum, YouTubeArtist, YouTubeArtistProfile, YouTubeSong } from '../../shared/types/music'
import { addToQueue, importButton, isPhone } from '../helpers/ui'

test.use({ serviceWorkers: 'block' })
const artists: YouTubeArtist[] = Array.from({ length: 7 }, (_, i) => ({ id: `UC${'a'.repeat(21)}${i}`, name: i ? `Artista ${i + 1}` : 'Artista prueba', artwork: null }))
const artist = artists[0]!
const refs = [{ id: artist.id, name: artist.name }]
const albums: YouTubeAlbum[] = Array.from({ length: 25 }, (_, i) => ({ id: `MPREalbum${i + 1}`, title: `Álbum ${i + 1}`, artists: refs, artwork: null, year: 2025 - i }))
const songs: YouTubeSong[] = Array.from({ length: 30 }, (_, i) => ({ videoId: i === 0 ? 'abcdefghijk' : i === 1 ? '12345678901' : `catalog${String(i).padStart(4, '0')}`, title: `Tema ${i + 1}`, artists: [artist.name], artistRefs: refs, album: albums[0]!.title, albumId: albums[0]!.id, artwork: null, duration: 20 }))
const profile: YouTubeArtistProfile = { ...artist, description: 'Música para descubrir, canción a canción.', topSongs: songs.slice(0, 2), albums: albums.slice(0, 6), singles: albums.slice(0, 6).map(album => ({ ...album, id: album.id + 'single', title: album.title.replace('Álbum', 'Single') })), expandable: { songs: true, albums: true, singles: true } }
let directory: string
let audio: Buffer
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-catalog-'))
  const path = join(directory, 'catalog.m4a')
  generateAudio(path, { duration: 20, format: 'aac', frequency: 410 })
  audio = await readFile(path)
})
test.beforeEach(async ({ request }) => { await request.post('/__test/youtube-audio', { data: audio }) })
test.afterAll(async () => {
  const target = resolve(directory)
  expect(target.startsWith(resolve(tmpdir()) + sep)).toBe(true)
  await rm(target, { recursive: true, force: true })
})
async function boot(page: Page, path = '/search') {
  await page.goto(path)
  await expect(importButton(page)).toBeEnabled()
}

test('validates catalog inputs before contacting the provider', async ({ request }) => {
  for (const path of ['/api/music/search?q=abc&type=unknown', '/api/music/artists/invalid', '/api/music/albums/invalid', `/api/music/artists/${artist.id}/songs?cursor=invalid`, `/api/music/artists/${artist.id}/releases?kind=invalid`, `/api/music/artists/${artist.id}/releases?kind=albums&cursor=invalid`]) {
    expect((await request.get(path)).status(), path).toBe(400)
  }
})

test('explores artists, expands releases, plays an album and restores search results', async ({ page }, info) => {
  let songRequests = 0; let artistRequests = 0; let albumRequests = 0; let releaseAttempts = 0
  await page.route('**/api/music/search?*', route => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('type') === 'album') {
      albumRequests++
      return route.fulfill({ json: { albums: query.has('cursor') ? albums.slice(6, 8) : albums.slice(0, 6), nextCursor: query.has('cursor') ? null : 'albums:6' } })
    }
    if (query.get('type') === 'artist') {
      artistRequests++
      return route.fulfill({ json: { artists: query.has('cursor') ? artists.slice(6) : artists.slice(0, 6), nextCursor: query.has('cursor') ? null : 'artists:6' } })
    }
    songRequests++
    return route.fulfill({ json: { songs: query.has('cursor') ? songs.slice(20) : songs.slice(0, 20), nextCursor: query.has('cursor') ? null : 'songs:20' } })
  })
  await page.route(`**/api/music/artists/${artist.id}`, route => route.fulfill({ json: profile }))
  await page.route(`**/api/music/artists/${artist.id}/songs*`, route => {
    const more = new URL(route.request().url()).searchParams.has('cursor')
    return route.fulfill({ json: { songs: more ? songs.slice(20) : songs.slice(0, 20), nextCursor: more ? null : 'artist:20' } })
  })
  await page.route(`**/api/music/artists/${artist.id}/releases?*`, route => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('kind') === 'singles') return route.fulfill({ json: { albums: profile.singles, nextCursor: null } })
    if (++releaseAttempts === 1) return route.fulfill({ status: 503, json: { message: 'Lanzamientos temporalmente no disponibles.' } })
    const cursor = query.get('cursor')
    return route.fulfill({ json: { albums: cursor === 'albums:24' ? albums.slice(24) : cursor ? albums.slice(12, 24) : albums.slice(0, 12), nextCursor: cursor === 'albums:24' ? null : cursor ? 'albums:24' : 'albums:12' } })
  })
  await page.route('**/api/music/albums/MPREalbum1', route => route.fulfill({ json: { ...albums[0], songs: songs.slice(0, 2) } }))
  await boot(page)
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill('catálogo')
  await expect(page.locator('.search-artist-grid .artist-card')).toHaveCount(6)
  const searchAlbums = page.getByRole('region', { name: 'Álbumes', exact: true })
  await expect(searchAlbums.locator('.album-card')).toHaveCount(6)
  await expect(searchAlbums.locator('.album-card').first()).toContainText(`${artist.name} · 2025`)
  await page.getByRole('tab', { name: 'Álbumes', exact: true }).click()
  await page.getByTestId('search-more').scrollIntoViewIfNeeded()
  await expect(page.locator('.catalog-release-grid .album-card')).toHaveCount(8)
  await page.getByRole('tab', { name: 'Artistas', exact: true }).click()
  await page.getByTestId('search-more').scrollIntoViewIfNeeded()
  await expect(page.locator('.search-artist-grid .artist-card')).toHaveCount(7)
  await page.getByRole('tab', { name: 'Canciones', exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await page.getByTestId('search-more').scrollIntoViewIfNeeded()
  await expect(page.getByRole('listitem')).toHaveCount(30)
  // Phone rows play on tap; the artist is reached from the song's options sheet.
  if (isPhone(info)) {
    const row = page.getByRole('list', { name: 'Canciones de YouTube Music' }).getByRole('listitem').filter({ hasText: artist.name }).last()
    await row.getByRole('button', { name: /^Opciones de / }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Ir al artista', exact: true }).click()
  } else await page.getByRole('list', { name: 'Canciones de YouTube Music' }).getByRole('link', { name: artist.name, exact: true }).last().click()
  await expect(page.getByRole('heading', { name: artist.name, exact: true })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `output/playwright/${info.project.name}-artist.png`, fullPage: true })
  await page.getByRole('button', { name: 'Ver todas las canciones' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await page.getByRole('button', { name: 'Cargar más canciones' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(30)
  const releases = page.getByRole('region', { name: 'Álbumes', exact: true })
  await releases.getByRole('button', { name: 'Ver más álbumes' }).click()
  await expect(releases.getByText('Lanzamientos temporalmente no disponibles.')).toBeVisible()
  await expect(releases.locator('.album-card')).toHaveCount(6)
  await releases.getByRole('button', { name: 'Reintentar álbumes' }).click()
  await expect(releases.locator('.album-card')).toHaveCount(12)
  await releases.getByRole('button', { name: 'Ver más álbumes' }).click()
  await expect(releases.locator('.album-card')).toHaveCount(24)
  await releases.getByRole('button', { name: 'Ver más álbumes' }).click()
  await expect(releases.locator('.album-card')).toHaveCount(25)
  await releases.getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: 'Álbum 1', exact: true })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `output/playwright/${info.project.name}-catalog-album.png`, fullPage: true })
  await page.getByRole('button', { name: 'Reproducir álbum' }).click()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await expect.poll(() => page.getByTestId('audio-engine').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.2)
  await page.getByRole('button', { name: 'Reproducir Tema 2', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Abrir reproductor ampliado' })).toContainText('Tema 2')
  await addToQueue(page, info, 'Tema 1')
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await page.goBack()
  await expect(page.getByRole('heading', { name: artist.name, exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('textbox', { name: 'Buscar en YouTube Music' })).toHaveValue('catálogo')
  await expect(page.getByRole('listitem')).toHaveCount(30)
  await expect(page.getByRole('tab', { name: 'Canciones', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
  expect(songRequests).toBe(2); expect(artistRequests).toBe(2); expect(albumRequests).toBe(2)
})

test('keeps artist and song failures independent and supports artist-only matches', async ({ page }) => {
  let songAttempts = 0; let artistAttempts = 0
  await page.route('**/api/music/search?*', route => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('type') === 'album') return route.fulfill({ json: { albums: [], nextCursor: null } })
    if (query.get('type') === 'artist') {
      if (query.get('q') === 'artistas fallan' && artistAttempts++ === 0) return route.fulfill({ status: 503, json: { message: 'No se pudieron consultar artistas.' } })
      return route.fulfill({ json: { artists: [artist], nextCursor: null } })
    }
    if (query.get('q') === 'canciones fallan' && songAttempts++ === 0) return route.fulfill({ status: 503, json: { message: 'No se pudieron consultar canciones.' } })
    return route.fulfill({ json: { songs: query.get('q') === 'solo artista' ? [] : songs.slice(0, 2), nextCursor: null } })
  })
  await boot(page)
  const input = page.getByRole('textbox', { name: 'Buscar en YouTube Music' })
  await input.fill('canciones fallan')
  await expect(page.getByText('No se pudieron consultar canciones.')).toBeVisible()
  await expect(page.locator('.search-preview .search-artist-grid .artist-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Reintentar búsqueda' }).click()
  await expect(page.getByRole('list', { name: 'Canciones principales de YouTube Music' }).getByRole('listitem')).toHaveCount(2)
  await input.fill('artistas fallan')
  await expect(page.getByText('No se pudieron consultar artistas.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Canciones principales de YouTube Music' }).getByRole('listitem')).toHaveCount(2)
  await page.getByRole('region', { name: 'Artistas', exact: true }).getByRole('button', { name: 'Reintentar búsqueda' }).click()
  await expect(page.locator('.search-preview .search-artist-grid .artist-card')).toHaveCount(1)
  await input.fill('solo artista')
  await expect(page.getByText('No hay canciones que coincidan. Prueba con otro título o artista.')).toBeVisible()
  await expect(page.locator('.search-preview .search-artist-grid .artist-card')).toHaveCount(1)
})

test('handles empty artists, failed details, missing pictures and disconnection', async ({ page, context }) => {
  let attempts = 0
  await page.route(`**/api/music/artists/${artist.id}`, route => {
    if (attempts++ === 0) return route.fulfill({ status: 503, json: { message: 'Perfil temporalmente no disponible.' } })
    return route.fulfill({ json: { ...profile, topSongs: [], albums: [], singles: [], artwork: 'https://image.example/broken', expandable: { songs: false, albums: false, singles: false } } })
  })
  await page.route('https://image.example/broken', route => route.fulfill({ status: 404, body: '' }))
  await boot(page, `/music/artist/${artist.id}`)
  await expect(page.getByText('Perfil temporalmente no disponible.')).toBeVisible()
  await page.getByRole('button', { name: 'Reintentar artista' }).click()
  await expect(page.getByRole('heading', { name: artist.name, exact: true })).toBeVisible()
  await expect(page.getByText('Este artista todavía no tiene canciones disponibles.')).toBeVisible()
  await expect(page.locator('.catalog-artist-hero .album-cover img')).toHaveCount(0)
  await expect(page.locator('.catalog-artist-hero').getByRole('button', { name: 'Reproducir', exact: true })).toBeDisabled()
  await context.setOffline(true)
  await expect(page.getByRole('heading', { name: 'Conecta para explorar este artista.' })).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByRole('heading', { name: artist.name, exact: true })).toBeVisible()
  await page.route('**/api/music/albums/MPREempty', route => route.fulfill({ json: { ...albums[0], id: 'MPREempty', songs: [] } }))
  await page.goto('/music/album/MPREempty')
  await expect(page.getByText('Este álbum no tiene pistas disponibles.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reproducir álbum' })).toBeDisabled()
})

test('refreshes expired artist continuations without losing the current list on failure', async ({ page }) => {
  let initial = 0
  await page.route(`**/api/music/artists/${artist.id}`, route => route.fulfill({ json: profile }))
  await page.route(`**/api/music/artists/${artist.id}/songs*`, route => {
    if (new URL(route.request().url()).searchParams.has('cursor')) return route.fulfill({ status: 410, json: { statusCode: 410, message: 'Las canciones caducaron.' } })
    return route.fulfill({ json: { songs: songs.slice(0, 20), nextCursor: ++initial === 1 ? 'expired:20' : null } })
  })
  await boot(page, `/music/artist/${artist.id}`)
  await page.getByRole('button', { name: 'Ver todas las canciones' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await page.getByRole('button', { name: 'Cargar más canciones' }).click()
  await expect(page.getByText('Las canciones caducaron.')).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await page.getByRole('button', { name: 'Actualizar canciones' }).click()
  await expect(page.getByText('Las canciones caducaron.')).toHaveCount(0)
  await expect(page.getByRole('listitem')).toHaveCount(20)
})
