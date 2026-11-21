import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpeg from 'ffmpeg-static'
import sharp from 'sharp'
import { artistTheme } from '../../shared/utils/artist-theme'
import type { MotionArtResult, YouTubeAlbum, YouTubeAlbumDetail, YouTubeArtist, YouTubeArtistProfile, YouTubeSong } from '../../shared/types/music'
import { importButton, isPhone } from '../helpers/ui'
import { generateAudio } from '../helpers/audio'

test.use({ serviceWorkers: 'block' })

const artist: YouTubeArtist = {
  id: 'UCrauw000000000000000000',
  name: 'Rauw Alejandro',
  artwork: 'https://example.com/rauw-artist.jpg',
}

const album: YouTubeAlbum = {
  id: 'MPREalbumrauw001',
  title: 'Cosa Nuestra',
  artists: [{ id: artist.id, name: artist.name }],
  artwork: 'https://example.com/rauw-album.jpg',
  year: 2024,
}

// Use videoId 'abcdefghijk' which is pre-registered in test fixture paths in tests/helpers/server.mjs
const song: YouTubeSong = {
  videoId: 'abcdefghijk',
  title: 'Déjame Entrar',
  artists: [artist.name],
  artistRefs: [{ id: artist.id, name: artist.name }],
  album: album.title,
  albumId: album.id,
  artwork: 'https://example.com/rauw-song.jpg',
  duration: 215,
}

const albumDetail: YouTubeAlbumDetail = {
  ...album,
  description: 'Álbum Cosa Nuestra de Rauw Alejandro',
  songs: [song],
}

const profile: YouTubeArtistProfile = {
  ...artist,
  banner: 'https://example.com/rauw-banner.jpg',
  description: 'Biografía completa de Rauw Alejandro para pruebas de navegación.',
  topSongs: [song],
  albums: [album],
  singles: [],
  similar: [],
  expandable: { songs: false, albums: false, singles: false },
}

const bannerColor = { r: 255, g: 120, b: 30 }
const bannerTheme = artistTheme(Array.from({ length: 256 }, () => Object.values(bannerColor)).flat(), 3)
let banner: Buffer, portrait: Buffer
let clip: Buffer, audio: Buffer, clipDirectory: string

test.beforeAll(async () => {
  banner = await sharp({ create: { width: 320, height: 180, channels: 3, background: bannerColor } }).png().toBuffer()
  portrait = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#245dca' } }).png().toBuffer()
  clipDirectory = await mkdtemp(join(tmpdir(), 'openfy-artist-motion-exit-'))
  const file = join(clipDirectory, 'clip.webm')
  const made = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=12', '-t', '1', '-c:v', 'libvpx', '-an', file], { windowsHide: true })
  if (made.status !== 0) throw new Error(made.stderr.toString())
  clip = await readFile(file)
  const sound = join(clipDirectory, 'artist.m4a')
  generateAudio(sound, { duration: 8, format: 'aac', frequency: 440 })
  audio = await readFile(sound)
})

test.afterAll(async () => {
  await rm(clipDirectory, { recursive: true, force: true })
})

async function boot(page: Page, path = '/') {
  await page.goto(path)
  await expect(importButton(page)).toBeEnabled()
}

test.describe('Artist page exit and navigation resilience (web client reproduction)', () => {
  let pageErrors: Error[] = []
  let consoleErrors: string[] = []

  test.beforeEach(async ({ page, request }) => {
    pageErrors = []
    consoleErrors = []
    page.on('pageerror', err => {
      // In WebKit, cross-origin beacon/activity unload checks between test origin and loopback can trigger this benign notice
      if (err.message?.includes('due to access control checks')) return
      pageErrors.push(err)
    })
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text()
        if (text.includes('due to access control checks')) return
        consoleErrors.push(text)
      }
    })

    await request.post('/__test/youtube-audio?videoId=' + song.videoId, { data: audio })

    await page.route('**/api/activity', route => route.fulfill({ json: { maintenance: false } }))
    await page.route('**/api/artwork/remote?*', route => {
      const source = new URL(route.request().url()).searchParams.get('url')
      return route.fulfill({ contentType: 'image/png', body: source === profile.banner ? banner : portrait })
    })
    await page.route(`**/api/music/artists/${artist.id}`, route => route.fulfill({ json: profile }))
    await page.route(`**/api/music/artists/${artist.id}/songs*`, route => route.fulfill({ json: { songs: [song], nextCursor: null } }))
    await page.route(`**/api/music/artists/${artist.id}/releases*`, route => route.fulfill({ json: { albums: [album], nextCursor: null } }))
    await page.route(`**/api/music/albums/${album.id}*`, route => route.fulfill({ json: albumDetail }))
    await page.route('**/api/albums/presentation', route => route.fulfill({
      json: {
        colors: { background: '#ff781e', text1: '#ffffff', text2: null, text3: null, text4: null },
        motion: { status: 'none' },
      },
    }))
    await page.route('**/api/motion/resolve', route => route.fulfill({
      json: {
        status: 'ready',
        url: '/api/motion/test-artist.mp4',
        width: 1920,
        height: 1080,
      } satisfies MotionArtResult,
    }))
    await page.route('**/api/motion/test-artist.mp4', route => route.fulfill({ contentType: 'video/webm', body: clip }))
    await page.route('**/api/music/search?*', route => {
      const url = new URL(route.request().url())
      const q = url.searchParams.get('q') || ''
      const type = url.searchParams.get('type')
      const matches = q.toLowerCase().includes('rauw')
      if (!matches) {
        return route.fulfill({ json: type === 'artist' ? { artists: [] } : type === 'album' ? { albums: [] } : { songs: [] } })
      }
      if (type === 'artist') return route.fulfill({ json: { artists: [artist], nextCursor: null } })
      if (type === 'album') return route.fulfill({ json: { albums: [album], nextCursor: null } })
      return route.fulfill({ json: { songs: [song], nextCursor: null } })
    })
  })

  async function assertState(page: Page, info: TestInfo, description: string) {
    // 1. Assert no loading spinner or skeleton remains
    await expect(page.locator('.spin, .catalog-more [role="status"]:has-text("Cargando"), .empty-state[role="status"]:has-text("Cargando")'), `${description}: no loading indicator remains`).toHaveCount(0)

    // 2. Assert navigation and shell controls remain responsive (desktop has persistent player bar; phone has mobile nav)
    if (isPhone(info)) {
      await expect(page.locator('.mobile-nav'), `${description}: mobile-nav is visible`).toBeVisible()
    } else {
      const playerBar = page.locator('.player-bar')
      await expect(playerBar, `${description}: player bar is visible`).toBeVisible()
    }

    // 3. Assert no page errors or console errors were raised
    expect(pageErrors, `${description}: no page errors occurred (${pageErrors.map(e => e.message).join('; ')})`).toEqual([])
    expect(consoleErrors, `${description}: no console errors occurred (${consoleErrors.join('; ')})`).toEqual([])
  }

  async function focusAndHoverControls(page: Page) {
    const topBar = page.locator('.topbar')
    const searchInput = page.getByRole('textbox', { name: 'Buscar en YouTube Music' })
    await topBar.hover()
    await searchInput.focus()
    await searchInput.hover()
  }

  test('(a) searches Rauw, opens artist page with motion/chrome, hovers/focuses topbar, goes to Inicio, and clears search with X', async ({ page }, info) => {
    await boot(page, '/')
    const searchInput = page.getByRole('textbox', { name: 'Buscar en YouTube Music' })

    // Step 1: Search "Rauw"
    await searchInput.fill('Rauw')
    await expect(page).toHaveURL(/\/search$/)
    const artistLink = page.getByRole('region', { name: 'Artistas' }).getByRole('link', { name: /Rauw Alejandro/i })
    await expect(artistLink).toBeVisible()

    // Step 2: Open artist page
    await artistLink.click()
    await expect(page).toHaveURL(new RegExp(`/music/artist/${artist.id}$`))
    await expect(page.locator('.artist-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: artist.name, exact: true })).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveClass(/\bartist-chrome\b/)
    await expect(page.locator('html')).toHaveClass(/\bpage-chrome\b/)

    // Step 3: Hover and focus search box and top bar while navigating
    await focusAndHoverControls(page)

    // Step 4: Go to Inicio
    if (isPhone(info)) {
      await page.locator('.mobile-nav').getByRole('link', { name: 'Inicio', exact: true }).click()
    } else {
      await page.getByRole('link', { name: 'Inicio', exact: true }).click()
    }
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('.home-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible()
    await expect(page.locator('.app-shell')).not.toHaveClass(/\bartist-chrome\b/)
    await assertState(page, info, 'After navigating to Inicio')

    // Step 5: Clear search with X button
    await expect(searchInput).toHaveValue('Rauw')
    const clearButton = page.getByRole('button', { name: 'Limpiar búsqueda' })
    await expect(clearButton).toBeVisible()
    await clearButton.click()
    await expect(searchInput).toHaveValue('')
    await expect(clearButton).toHaveCount(0)

    // Verify search cleared destination content and no loading state persists
    await expect(page.getByRole('heading', { name: '¿Qué quieres escuchar?', exact: true })).toBeVisible()
    await assertState(page, info, 'After clearing search with X')
  })

  test('(b) from artist page with motion/chrome, hovers/focuses topbar, then visits Biblioteca, Descargas and Más reproducidas', async ({ page }, info) => {
    // Open artist page directly
    await boot(page, `/music/artist/${artist.id}`)
    await expect(page.locator('.artist-page')).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveClass(/\bartist-chrome\b/)

    // --- Sub-step 1: Navigate to Biblioteca ---
    await focusAndHoverControls(page)
    if (isPhone(info)) {
      await page.locator('.mobile-nav').getByRole('link', { name: 'Tu biblioteca', exact: true }).click()
    } else {
      await page.getByRole('link', { name: 'Tu biblioteca', exact: true }).click()
    }
    await expect(page).toHaveURL(/\/library$/)
    await expect(page.locator('.library-heading')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tu biblioteca', exact: true })).toBeVisible()
    await expect(page.locator('.app-shell')).not.toHaveClass(/\bartist-chrome\b/)
    await assertState(page, info, 'After navigating from artist to Biblioteca')

    // --- Sub-step 2: Return to artist, then navigate to Descargas ---
    await page.goBack()
    await expect(page.locator('.artist-page')).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveClass(/\bartist-chrome\b/)
    await focusAndHoverControls(page)

    if (isPhone(info)) {
      await page.locator('.mobile-nav').getByRole('link', { name: 'Descargas', exact: true }).click()
    } else {
      await page.locator('a[href="/downloads"]').first().click()
    }
    await expect(page).toHaveURL(/\/downloads$/)
    await expect(page.getByRole('heading', { name: 'Siempre contigo', exact: true })).toBeVisible()
    await expect(page.locator('.storage-panel')).toBeVisible()
    await expect(page.locator('.app-shell')).not.toHaveClass(/\bartist-chrome\b/)
    await assertState(page, info, 'After navigating from artist to Descargas')

    // --- Sub-step 3: Return to artist, then navigate to Más reproducidas ---
    await page.goBack()
    await expect(page.locator('.artist-page')).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveClass(/\bartist-chrome\b/)
    await focusAndHoverControls(page)

    if (isPhone(info)) {
      await page.goto('/most-played')
    } else {
      await page.locator('a[href="/most-played"]').first().click()
    }
    await expect(page).toHaveURL(/\/most-played$/)
    await expect(page.getByRole('heading', { name: 'Tus más reproducidas', exact: true })).toBeVisible()
    await expect(page.locator('.ranking-order')).toBeVisible()
    await expect(page.locator('.app-shell')).not.toHaveClass(/\bartist-chrome\b/)
    await assertState(page, info, 'After navigating from artist to Más reproducidas')
  })

  test('(c) from artist page with motion/chrome, hovers/focuses topbar, opens album directly, and plays tracks', async ({ page }, info) => {
    await boot(page, `/music/artist/${artist.id}`)
    await expect(page.locator('.artist-page')).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveClass(/\bartist-chrome\b/)

    // Hover and focus topbar/search box before opening album
    await focusAndHoverControls(page)

    // Open album directly from artist releases
    const albumCard = page.locator('.artist-latest-card, .artist-releases .album-card').first()
    await expect(albumCard).toBeVisible()
    await albumCard.click()

    // Assert destination album page is loaded
    await expect(page).toHaveURL(new RegExp(`/music/album/${album.id}$`))
    await expect(page.locator('.album-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: album.title, exact: true })).toBeVisible()
    await assertState(page, info, 'After opening album directly from artist page')

    // Assert player bar responds to interaction
    const playAlbumButton = page.getByRole('button', { name: 'Reproducir álbum', exact: true })
    await expect(playAlbumButton).toBeVisible()
    await playAlbumButton.click()

    // Player bar should display the song and play/pause controls should respond
    const playerBar = page.locator('.player-bar')
    await expect(playerBar, 'Player bar is visible and playing').toBeVisible()
    await expect(playerBar).toContainText(song.title)
    const pauseButton = page.getByRole('button', { name: 'Pausar', exact: true })
    await expect(pauseButton).toBeVisible()
    await pauseButton.click()
    const resumeButton = page.getByRole('button', { name: 'Reproducir', exact: true })
    await expect(resumeButton).toBeVisible()
    await assertState(page, info, 'After playing and pausing album track from player bar')
  })

  test('clearing search with X button directly while on the artist page resets search cleanly without crash', async ({ page }, info) => {
    await boot(page, '/')
    const searchInput = page.getByRole('textbox', { name: 'Buscar en YouTube Music' })

    // Search and navigate to artist
    await searchInput.fill('Rauw')
    const artistLink = page.getByRole('region', { name: 'Artistas' }).getByRole('link', { name: /Rauw Alejandro/i })
    await expect(artistLink).toBeVisible()
    await artistLink.click()

    await expect(page.locator('.artist-page')).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveClass(/\bartist-chrome\b/)

    // Focus search box and click clear (X) button directly on artist page
    await searchInput.focus()
    await searchInput.hover()
    const clearButton = page.getByRole('button', { name: 'Limpiar búsqueda' })
    await expect(clearButton).toBeVisible()
    await clearButton.click()

    // Input must be empty, search resets cleanly, no crash
    await expect(searchInput).toHaveValue('')
    await expect(clearButton).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '¿Qué quieres escuchar?', exact: true })).toBeVisible()
    await assertState(page, info, 'After clicking X on artist page')
  })
})
