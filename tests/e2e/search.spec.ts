import { test, expect, type Page } from '@playwright/test'
import type { YouTubeAlbum, YouTubeArtist, YouTubeSong } from '../../shared/types/music'
import { importButton } from '../helpers/ui'

test.use({ serviceWorkers: 'block' })
const artist: YouTubeArtist = { id: 'UCsearch0000000000000000', name: 'Openfy', artwork: null }
const songs = (start: number, count: number): YouTubeSong[] => Array.from({ length: count }, (_, i) => ({ videoId: `search${String(start + i).padStart(5, '0')}`, title: `Canción ${start + i}`, artists: ['Openfy'], artistRefs: [{ id: artist.id, name: artist.name }], album: 'Descubrimientos', artwork: null, duration: 180 }))
const artists = (start: number, count: number): YouTubeArtist[] => Array.from({ length: count }, (_, i) => ({ ...artist, id: `${artist.id}${start + i}`, name: start + i === 1 ? artist.name : `Artista ${start + i}` }))
const albums = (start: number, count: number): YouTubeAlbum[] => Array.from({ length: count }, (_, i) => ({ id: `MPREsearch${start + i}`, title: `Álbum ${start + i}`, artists: [{ id: artist.id, name: artist.name }], artwork: null, year: 2026 }))
async function boot(page: Page, path = '/') { await page.goto(path); await expect(importButton(page)).toBeEnabled(); await expect(page.getByRole('textbox', { name: 'Buscar en YouTube Music' })).toBeVisible() }
const input = (page: Page) => page.getByRole('textbox', { name: 'Buscar en YouTube Music' })
async function mock(page: Page) {
  await page.route('**/api/music/search?*', route => {
    const type = new URL(route.request().url()).searchParams.get('type')
    return route.fulfill({ json: type === 'artist' ? { artists: artists(1, 6), nextCursor: null } : type === 'album' ? { albums: albums(1, 6), nextCursor: null } : { songs: songs(1, 20), nextCursor: null } })
  })
}

test('searches from the shell and presents the summary with existing cards', async ({ page }, info) => {
  await mock(page); await boot(page)
  await expect(page.getByRole('complementary', { name: 'Navegación principal' }).getByRole('link', { name: 'Buscar', exact: true })).toHaveCount(0)
  await input(page).fill('Openfy')
  await expect(page).toHaveURL(/\/search$/)
  await expect(page.getByRole('tab')).toHaveText(['Todo', 'Canciones', 'Artistas', 'Álbumes'])
  await expect(page.getByRole('tab', { name: 'Todo', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.search-featured .artist-card')).toContainText('Openfy')
  await expect(page.getByRole('list', { name: 'Canciones principales de YouTube Music' }).getByRole('listitem')).toHaveCount(4)
  await expect(page.locator('.search-preview .artist-card')).toHaveCount(6)
  await expect(page.locator('.search-preview .catalog-release-grid .album-card')).toHaveCount(6)
  await expect(page.getByRole('button', { name: /^(Más canciones|Ver más artistas|Ver más álbumes)$/ })).toHaveCount(0)
  await expect(input(page)).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `output/search-qa/${info.project.name}-summary.png`, fullPage: true })
})

test('debounces, preserves the category on edits and clears to an empty search', async ({ page }) => {
  const queries: string[] = []
  await page.route('**/api/music/search?*', route => {
    const q = new URL(route.request().url()).searchParams
    if (!q.has('type')) queries.push(q.get('q')!)
    return route.fulfill({ json: q.get('type') === 'artist' ? { artists: [] } : q.get('type') === 'album' ? { albums: [] } : { songs: songs(1, 20), nextCursor: null } })
  })
  await boot(page, '/search'); await input(page).fill('a'); await page.waitForTimeout(400); expect(queries).toEqual([])
  await page.getByRole('tab', { name: 'Canciones', exact: true }).click()
  await input(page).fill('ho'); await input(page).fill('horizonte'); await input(page).press('Enter')
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await page.waitForTimeout(400); expect(queries).toEqual(['horizonte'])
  await input(page).fill('nueva'); await expect.poll(() => queries).toEqual(['horizonte', 'nueva'])
  await expect(page.getByRole('tab', { name: 'Canciones', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click()
  await expect(input(page)).toHaveValue(''); await expect(input(page)).toBeFocused()
  await expect(page.getByRole('heading', { name: '¿Qué quieres escuchar?', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Todo', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('loads song continuations only in their category, deduplicates and stops at the end', async ({ page }, info) => {
  const requests: (string | null)[] = []
  await page.route('**/api/music/search?*', route => {
    const q = new URL(route.request().url()).searchParams
    if (q.has('type')) return route.fulfill({ json: q.get('type') === 'artist' ? { artists: [] } : { albums: [] } })
    const cursor = q.get('cursor'); requests.push(cursor)
    return route.fulfill({ json: cursor === '20' ? { songs: songs(20, 11), nextCursor: '30' } : cursor === '30' ? { songs: songs(31, 10), nextCursor: null } : { songs: songs(1, 20), nextCursor: '20' } })
  })
  await boot(page); await input(page).fill('scroll')
  await expect(page.getByRole('list', { name: 'Canciones principales de YouTube Music' }).getByRole('listitem')).toHaveCount(4)
  await page.getByRole('heading', { name: 'Álbumes', exact: true }).scrollIntoViewIfNeeded()
  expect(requests).toEqual([null])
  await page.getByRole('tab', { name: 'Canciones', exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await page.getByTestId('search-more').scrollIntoViewIfNeeded(); await expect(page.getByRole('listitem')).toHaveCount(30)
  await page.getByTestId('search-more').scrollIntoViewIfNeeded(); await expect(page.getByRole('listitem')).toHaveCount(40)
  await expect(page.getByText('No hay más canciones para esta búsqueda.')).toBeVisible()
  expect(requests).toEqual([null, '20', '30'])
  await page.screenshot({ path: `output/search-qa/${info.project.name}-songs.png`, fullPage: false })
})

test('retries a failed artist continuation without a loop and automatically fills the viewport', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/music/search?*', route => {
    const q = new URL(route.request().url()).searchParams
    if (q.get('type') !== 'artist') return route.fulfill({ json: { songs: [], albums: [] } })
    if (q.has('cursor') && ++attempts === 1) return route.fulfill({ status: 503, json: { message: 'Artistas temporalmente no disponibles.' } })
    return route.fulfill({ json: q.has('cursor') ? { artists: artists(7, 18), nextCursor: null } : { artists: artists(1, 6), nextCursor: '6' } })
  })
  await boot(page, '/search'); await page.getByRole('tab', { name: 'Artistas', exact: true }).click(); await input(page).fill('Openfy')
  await page.getByTestId('search-more').scrollIntoViewIfNeeded()
  await expect(page.getByText('Artistas temporalmente no disponibles.')).toBeVisible()
  await expect(page.locator('#youtube-results .artist-card')).toHaveCount(6)
  await page.waitForTimeout(400); expect(attempts).toBe(1)
  await page.getByRole('button', { name: 'Reintentar carga', exact: true }).click()
  await expect(page.locator('#youtube-results .artist-card')).toHaveCount(24); expect(attempts).toBe(2)
})

test('restores query, category and scroll after visiting an artist', async ({ page }) => {
  let searches = 0
  await page.route('**/api/music/search?*', route => { searches++; const type = new URL(route.request().url()).searchParams.get('type'); return route.fulfill({ json: type === 'artist' ? { artists: [artist] } : type === 'album' ? { albums: [] } : { songs: songs(1, 20), nextCursor: null } }) })
  await page.route(`**/api/music/artists/${artist.id}`, route => route.fulfill({ json: { ...artist, description: '', topSongs: songs(1, 4), albums: [], singles: [], similar: [], links: {} } }))
  await boot(page, '/search'); await page.getByRole('tab', { name: 'Canciones', exact: true }).click(); await input(page).fill('Openfy')
  await expect(page.getByRole('listitem')).toHaveCount(20)
  const row = page.getByRole('listitem').nth(15)
  await row.getByRole('button', { name: /^Opciones de / }).click()
  const offset = await page.evaluate(() => scrollY)
  await page.getByRole('dialog').getByRole('button', { name: 'Ir al artista', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/music/artist/${artist.id}$`))
  await page.goBack(); await expect(page.getByRole('listitem')).toHaveCount(20)
  await expect(page.getByRole('tab', { name: 'Canciones', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(input(page)).toHaveValue('Openfy')
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(offset, 0)
  expect(searches).toBe(3)
})
