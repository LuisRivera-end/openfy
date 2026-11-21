import { test, expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpeg from 'ffmpeg-static'
import sharp from 'sharp'
import { artistTheme } from '../../shared/utils/artist-theme'
import type { MotionArtResult, YouTubeAlbum, YouTubeArtist, YouTubeArtistProfile, YouTubeSong } from '../../shared/types/music'
import { importButton } from '../helpers/ui'
import { generateAudio } from '../helpers/audio'

test.use({ serviceWorkers: 'block' })

const artist: YouTubeArtist = {
  id: 'UCtestartist0000000000000',
  name: 'Artista Prueba',
  artwork: 'https://example.com/artist.jpg',
}

const album: YouTubeAlbum = {
  id: 'MPREalbumtest001',
  title: 'Álbum Prueba',
  artists: [{ id: artist.id, name: artist.name }],
  artwork: 'https://example.com/album.jpg',
  year: 2026,
}

const song: YouTubeSong = {
  videoId: 'abcdefghijk',
  title: 'Canción Prueba',
  artists: [artist.name],
  artistRefs: [{ id: artist.id, name: artist.name }],
  album: album.title,
  albumId: album.id,
  artwork: 'https://example.com/song.jpg',
  duration: 180,
}

const profile: YouTubeArtistProfile = {
  ...artist,
  banner: 'https://example.com/banner.jpg',
  description: 'Biografía del artista de prueba con suficiente texto para la descripción de perfil.',
  topSongs: [song],
  albums: [album],
  singles: [],
  similar: [],
  expandable: { songs: false, albums: false, singles: false },
}

const bannerColor = { r: 255, g: 217, b: 26 }
const bannerTheme = artistTheme(Array.from({ length: 256 }, () => Object.values(bannerColor)).flat(), 3)
let banner: Buffer, portrait: Buffer
// A real VP8 clip: the page drops the video on a decoding error, so a fake body would never stay attached.
let clip: Buffer, audio: Buffer, clipDirectory: string
test.beforeAll(async () => {
  banner = await sharp({ create: { width: 320, height: 180, channels: 3, background: bannerColor } }).png().toBuffer()
  portrait = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#245dca' } }).png().toBuffer()
  clipDirectory = await mkdtemp(join(tmpdir(), 'openfy-artist-motion-'))
  const file = join(clipDirectory, 'clip.webm')
  const made = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=12', '-t', '1', '-c:v', 'libvpx', '-an', file], { windowsHide: true })
  if (made.status !== 0) throw new Error(made.stderr.toString())
  clip = await readFile(file)
  const sound = join(clipDirectory, 'artist.m4a')
  generateAudio(sound, { duration: 8, format: 'aac', frequency: 440 })
  audio = await readFile(sound)
})
test.afterAll(async () => { await rm(clipDirectory, { recursive: true, force: true }) })

async function boot(page: Page, path = '/') {
  await page.goto(path)
  await expect(importButton(page)).toBeEnabled()
}

test.describe('Artist visual identity and header motion', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/artwork/remote?*', route => {
      const source = new URL(route.request().url()).searchParams.get('url')
      return route.fulfill({ contentType: 'image/png', body: source === profile.banner ? banner : portrait })
    })
    await page.route(`**/api/music/artists/${artist.id}`, route => route.fulfill({ json: profile }))
    await page.route(`**/api/music/artists/${artist.id}/songs*`, route => route.fulfill({ json: { songs: [song], nextCursor: null } }))
    await page.route(`**/api/music/artists/${artist.id}/releases*`, route => route.fulfill({ json: { albums: [album], nextCursor: null } }))
  })

  test('bright artwork updates the palette and song metadata stays legible', async ({ page }) => {
    await page.route('**/api/motion/resolve', route => route.fulfill({ json: { status: 'none' } satisfies MotionArtResult }))
    await boot(page, `/music/artist/${artist.id}`)
    await expect(page.locator('.artist-page')).toBeVisible()

    await expect.poll(() => page.locator('.artist-page').evaluate(el => getComputedStyle(el).getPropertyValue('--artist-base').trim())).toBe(bannerTheme.base)
    await expect(page.locator('.artist-popular .track-duration').first()).toHaveCSS('color', 'rgb(237, 237, 240)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  })

  test('a missing banner falls back to the portrait on a narrow phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    const name = 'Un artista con un nombre muy largo'
    await page.route(`**/api/music/artists/${artist.id}`, route => route.fulfill({ json: { ...profile, name, banner: null } }))
    await page.route('**/api/motion/resolve', route => route.fulfill({ json: { status: 'none' } satisfies MotionArtResult }))
    await boot(page, `/music/artist/${artist.id}`)
    await expect(page.locator('.artist-stage .artist-portrait img')).toBeVisible()
    const bounds = await page.getByRole('heading', { name }).boundingBox()
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360)
  })

  test('the unfolded Galaxy Fold keeps artist tracks clear of the latest release', async ({ page }) => {
    await page.setViewportSize({ width: 884, height: 1104 })
    await page.route('**/api/motion/resolve', route => route.fulfill({ json: { status: 'none' } satisfies MotionArtResult }))
    await boot(page, `/music/artist/${artist.id}`)
    const tracks = page.getByRole('region', { name: 'Canciones populares' })
    const release = page.getByRole('complementary', { name: 'Último lanzamiento' })
    await expect(tracks).toBeVisible()
    await expect(release).toBeVisible()
    const [popular, latest] = await Promise.all([tracks.boundingBox(), release.boundingBox()])
    expect(latest!.y).toBeGreaterThanOrEqual(popular!.y + popular!.height)
    expect(await tracks.locator('.track-row').first().evaluate(row => row.scrollWidth)).toBeLessThanOrEqual(Math.ceil(popular!.width))
  })

  test('the artist image spans the controls and opens the biography without leaving the page', async ({ page }) => {
    await page.route('**/api/motion/resolve', route => route.fulfill({ json: { status: 'none' } satisfies MotionArtResult }))
    await boot(page, `/music/artist/${artist.id}`)
    const stage = page.locator('.artist-stage')
    await expect(stage.locator('.artist-backdrop img')).toBeVisible()
    const play = stage.getByRole('button', { name: 'Reproducir', exact: true })
    const controls = await play.boundingBox()
    const banner = await stage.locator('.artist-backdrop').boundingBox()
    const back = await page.locator('.topbar .topbar-back').boundingBox()
    expect(banner!.y).toBeLessThan(back!.y + back!.height / 2)
    expect(banner!.y + banner!.height).toBeGreaterThanOrEqual(controls!.y + controls!.height)
    await expect(page.locator('.app-shell')).toHaveClass(/\bartist-chrome\b/)
    await expect(page.locator('html')).toHaveClass(/\bpage-chrome\b/)
    // As in Apple Music, the biography lives only behind the hero's information button.
    await expect(page.getByRole('heading', { name: 'Acerca de', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Leer biografía' })).toHaveCount(0)

    await stage.getByRole('button', { name: /acerca de|información/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(profile.description!, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await page.goto('/settings')
    await expect(page.locator('.app-shell')).not.toHaveClass(/\bartist-chrome\b/)
  })

  test('on a phone the header art reaches the status bar and the search row gives way to it', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-webkit', 'Phone layout.')
    await page.route('**/api/motion/resolve', route => route.fulfill({ json: { status: 'none' } satisfies MotionArtResult }))
    await boot(page, `/music/artist/${artist.id}`)
    await expect(page.locator('.artist-stage .artist-backdrop img')).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveClass(/\bartist-chrome\b/)
    await expect(page.getByRole('textbox', { name: 'Buscar en YouTube Music' })).toBeHidden()
    await expect(page.locator('.topbar .topbar-back')).toBeVisible()
    expect((await page.locator('.artist-backdrop').boundingBox())!.y).toBeLessThanOrEqual(0)

    const scrollDriven = await page.evaluate(() => CSS.supports('animation-timeline: scroll()'))
    test.skip(!scrollDriven, 'Without scroll-driven animations the strip stays solid.')
    const strip = page.locator('.status-backdrop')
    // The animation interpolates towards a color-mix(), so WebKit may serialise the clear end as oklab(… / 0).
    const clear = /(\/ 0\)|, 0\))$/
    await expect(strip).toHaveCSS('background-color', clear)
    await page.addStyleTag({ content: '.artist-page { padding-bottom: 2000px; }' })
    await page.evaluate(() => window.scrollTo(0, 600))
    await expect.poll(() => strip.evaluate(el => getComputedStyle(el).backgroundColor)).not.toMatch(clear)

    await page.goto('/library')
    await expect(page.getByRole('textbox', { name: 'Buscar en YouTube Music' })).toBeVisible()
  })

  test('with mocked motion ready and an mp4 route the video appears and the banner remains as fallback underneath', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium', 'VP8 playback is exercised in Chromium; WebKit coverage lives in motion-art.spec.ts.')
    await page.route('**/api/motion/resolve', route => {
      route.fulfill({
        json: {
          status: 'ready',
          url: '/api/motion/test-artist.mp4',
          width: 1920,
          height: 1080,
        } satisfies MotionArtResult,
      })
    })
    await page.route('**/api/motion/test-artist.mp4', route => {
      route.fulfill({ contentType: 'video/webm', body: clip })
    })

    await boot(page, `/music/artist/${artist.id}`)
    await expect(page.locator('.catalog-artist-hero .artist-backdrop .artist-header-video.is-playing')).toBeAttached()
    await expect(page.locator('.catalog-artist-hero .artist-backdrop .album-cover')).toBeAttached()
  })

  test('with emulated reduced motion no motion request is made', async ({ page }) => {
    let motionRequested = false
    await page.route('**/api/motion/resolve', route => {
      motionRequested = true
      return route.fulfill({ json: { status: 'none' } satisfies MotionArtResult })
    })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await boot(page, `/music/artist/${artist.id}`)
    await expect(page.getByRole('heading', { name: artist.name, exact: true })).toBeVisible()
    await page.waitForTimeout(300)

    expect(motionRequested).toBe(false)
  })

  test('the search result keeps its gradient and plays the artist in place', async ({ page, request }) => {
    expect((await request.post('/__test/youtube-audio', { data: audio })).ok()).toBeTruthy()
    await page.route('**/api/music/search?*', route => {
      const type = new URL(route.request().url()).searchParams.get('type')
      if (type === 'album') return route.fulfill({ json: { albums: [] } })
      if (type === 'song') return route.fulfill({ json: { songs: [] } })
      return route.fulfill({ json: { artists: [artist], nextCursor: null } })
    })

    await boot(page, '/search')
    const searchInput = page.getByRole('textbox', { name: 'Buscar en YouTube Music' })
    await searchInput.fill('Artista Prueba')

    const card = page.locator('.search-featured-card')
    await expect(card).toBeVisible()

    const background = await card.evaluate(el => getComputedStyle(el).background || getComputedStyle(el).backgroundImage)
    expect(background).toContain('gradient')

    const playButton = card.locator('.search-featured-play')
    await expect(playButton).toBeVisible()
    const ariaLabel = await playButton.getAttribute('aria-label')
    expect(ariaLabel).toBeTruthy()
    expect(ariaLabel).toMatch(/Reproducir/i)
    await playButton.click()
    await expect(page.getByRole('contentinfo', { name: 'Reproductor' }).getByText(song.title, { exact: true })).toBeVisible()
    await expect.poll(async () => (await (await request.get('/__test/youtube-audio')).json()).requests).toBeGreaterThan(0)
    expect(new URL(page.url()).pathname).toBe('/search')
  })
})
