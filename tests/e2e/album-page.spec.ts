import { test, expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpeg from 'ffmpeg-static'
import sharp from 'sharp'
import { albumTint } from '../../shared/utils/album-tint'
import type { AlbumPresentation, YouTubeAlbumDetail } from '../../shared/types/music'
import { importButton } from '../helpers/ui'

test.use({ serviceWorkers: 'block' })

const testAlbum: YouTubeAlbumDetail = {
  id: 'MPREalbumtest1',
  title: 'Un Verano Sin Ti',
  artists: [{ id: 'UCbadbunny', name: 'Bad Bunny' }],
  artwork: 'https://example.com/un-verano-sin-ti.jpg',
  year: 2022,
  description: 'Descripción básica de YouTube Music',
  songs: [
    {
      videoId: 'song1',
      title: 'Moscow Mule',
      artists: ['Bad Bunny'],
      artistRefs: [{ id: 'UCbadbunny', name: 'Bad Bunny' }],
      album: 'Un Verano Sin Ti',
      albumId: 'MPREalbumtest1',
      artwork: 'https://example.com/un-verano-sin-ti.jpg',
      duration: 245,
    },
    {
      videoId: 'song2',
      title: 'Después de la Playa',
      artists: ['Bad Bunny'],
      album: 'Un Verano Sin Ti',
      albumId: 'MPREalbumtest1',
      artwork: 'https://example.com/un-verano-sin-ti.jpg',
      duration: 231,
    },
  ],
}

let clipDirectory: string
let clip: Buffer
let coverBuffer: Buffer
let greenCoverBuffer: Buffer

test.beforeAll(async () => {
  clipDirectory = await mkdtemp(join(tmpdir(), 'openfy-album-motion-'))
  const clipFile = join(clipDirectory, 'clip.webm')
  const made = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x160:rate=12', '-t', '1', '-c:v', 'libvpx', '-an', clipFile], { windowsHide: true })
  if (made.status !== 0) throw new Error(made.stderr.toString())
  clip = await readFile(clipFile)

  coverBuffer = await sharp({
    create: { width: 128, height: 128, channels: 3, background: { r: 89, g: 0, b: 25 } },
  }).png().toBuffer()

  greenCoverBuffer = await sharp({
    create: { width: 128, height: 128, channels: 3, background: { r: 0, g: 255, b: 0 } },
  }).png().toBuffer()
})

test.afterAll(async () => {
  await rm(clipDirectory, { recursive: true, force: true })
})

async function boot(page: Page, path = `/music/album/${testAlbum.id}`) {
  await page.goto(path)
  await expect(importButton(page)).toBeEnabled()
}

test.describe('Album page visual redesign', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/music/recommendations**', route => route.fulfill({ json: { songs: [], generatedAt: 0, stale: false, error: null } }))
    await page.route(`**/api/music/albums/${testAlbum.id}*`, route => route.fulfill({ json: testAlbum }))
    await page.route('**/api/artwork/remote?*', route => route.fulfill({ contentType: 'image/png', body: coverBuffer }))
  })

  test('page background equals albumTint(bgColor).background', async ({ page }) => {
    const bgColor = '#590019'
    const expected = albumTint(bgColor)

    await page.route('**/api/albums/presentation', route => route.fulfill({
      json: {
        colors: {
          background: bgColor,
          text1: '#FFFFFF',
          text2: null,
          text3: null,
          text4: null,
        },
        motion: { status: 'none' },
      } satisfies AlbumPresentation,
    }))

    await boot(page)
    const albumPage = page.locator('.album-page')
    await expect(albumPage).toBeVisible()

    await expect.poll(() => albumPage.evaluate(el => getComputedStyle(el).getPropertyValue('--album-bg').trim().toUpperCase())).toBe(expected.background)
  })

  test('track row secondary text and artist links use var(--album-muted)', async ({ page }) => {
    await page.route('**/api/albums/presentation', route => route.fulfill({
      json: {
        colors: {
          background: '#590019',
          text1: null,
          text2: null,
          text3: null,
          text4: null,
        },
        motion: { status: 'none' },
      } satisfies AlbumPresentation,
    }))

    await boot(page)
    const artistLink = page.locator('.album-page .track-row .music-artist-names a').first()
    await expect(artistLink).toBeVisible()
    // albumTint('#590019').muted: the page colour lifted by a grey, so secondary text keeps the album's hue.
    // Polled because the colour eases in from the neutral tint over 240 ms.
    await expect.poll(() => artistLink.evaluate(el => getComputedStyle(el).color)).toBe('rgb(250, 161, 191)')
  })

  test('the album colour reaches the window frame and leaves with the page', async ({ page }) => {
    const expected = albumTint('#590019')
    await page.route('**/api/albums/presentation', route => route.fulfill({
      json: { colors: { background: '#590019', text1: null, text2: null, text3: null, text4: null }, motion: { status: 'none' } } satisfies AlbumPresentation,
    }))
    await boot(page)
    const html = page.locator('html')
    await expect(html).toHaveClass(/\bpage-chrome\b/)
    await expect.poll(() => html.evaluate(el => getComputedStyle(el).getPropertyValue('--chrome-background').trim().toUpperCase())).toBe(expected.background)
    await expect.poll(() => html.evaluate(el => getComputedStyle(el).getPropertyValue('--chrome-surface').trim().toUpperCase())).toBe(expected.surface)
    await page.goto('/settings')
    await expect(html).not.toHaveClass(/\bpage-chrome\b/)
  })

  test('opening "Más" dialog pauses header motion art', async ({ page }, info) => {
    // Playwright's WebKit cannot decode the WebM test clip, so the header correctly falls back to the static cover there.
    test.skip(info.project.name !== 'chromium', 'Needs a decodable clip')
    const fullText = 'Un Verano Sin Ti es el cuarto álbum de estudio.\n\nContiene veintitrés pistas.\n\nFue lanzado en mayo de 2022 y batió récords mundiales.'

    await page.route('**/api/albums/presentation', route => route.fulfill({
      json: {
        description: {
          text: fullText,
          source: 'apple',
        },
        colors: {
          background: '#590019',
          text1: null,
          text2: null,
          text3: null,
          text4: null,
        },
        motion: {
          status: 'ready',
          url: '/api/motion/test-album-clip.mp4',
          width: 224,
          height: 224,
        },
      } satisfies AlbumPresentation,
    }))

    await page.route('**/api/motion/test-album-clip.mp4', route => route.fulfill({
      contentType: 'video/webm',
      body: clip,
    }))

    await boot(page)
    const video = page.locator('.album-cover video.motion-art')
    await expect(video).toBeAttached()

    const moreButton = page.locator('.album-description-more')
    await expect(moreButton).toBeVisible()
    await moreButton.click()

    const dialog = page.locator('.app-dialog.album-description-dialog')
    await expect(dialog).toBeVisible()
    await expect.poll(async () => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true)

    await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
    await expect(dialog).toBeHidden()
  })

  test('description clamped with "Más" opening a dialog with full text + attribution', async ({ page }) => {
    const fullText = 'Un Verano Sin Ti es el cuarto álbum de estudio en solitario del artista Bad Bunny.\n\nContiene veintitrés pistas que recorren diferentes sonidos caribeños, desde el reguetón hasta el mambo y la bachata.\n\nFue lanzado en mayo de 2022 y batió récords mundiales de reproducciones en streaming.'

    await page.route('**/api/albums/presentation', route => route.fulfill({
      json: {
        description: {
          text: fullText,
          source: 'apple',
        },
        colors: {
          background: '#590019',
          text1: null,
          text2: null,
          text3: null,
          text4: null,
        },
        motion: { status: 'none' },
      } satisfies AlbumPresentation,
    }))

    await boot(page)
    const descriptionBlock = page.locator('.album-description')
    await expect(descriptionBlock).toBeVisible()

    const moreButton = descriptionBlock.locator('.album-description-more')
    await expect(moreButton).toBeVisible()
    await expect(moreButton).toHaveText('Más')

    await moreButton.click()

    const dialog = page.locator('.app-dialog.album-description-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: testAlbum.title })).toBeVisible()
    await expect(dialog.getByText('Un Verano Sin Ti es el cuarto álbum')).toBeVisible()
    await expect(dialog.getByText('Texto de Apple Music')).toBeVisible()

    await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
    await expect(dialog).toBeHidden()
    await expect(moreButton).toBeFocused()
  })

  test('no description block when absent', async ({ page }) => {
    await page.route(`**/api/music/albums/${testAlbum.id}*`, route => route.fulfill({ json: { ...testAlbum, description: null } }))
    await page.route('**/api/albums/presentation', route => route.fulfill({
      json: {
        colors: {
          background: '#0B0B16',
          text1: null,
          text2: null,
          text3: null,
          text4: null,
        },
        motion: { status: 'none' },
      } satisfies AlbumPresentation,
    }))

    await boot(page)
    await expect(page.locator('.album-description')).toHaveCount(0)
  })

  test('motion video appears when allowed and not under reducedMotion: "reduce"', async ({ page }) => {
    let requestedMotion: boolean | undefined

    await page.route('**/api/albums/presentation', route => {
      const body = route.request().postDataJSON()
      requestedMotion = body?.motion
      return route.fulfill({
        json: {
          motion: body?.motion
            ? {
                status: 'ready',
                url: '/api/motion/test-album-clip.mp4',
                width: 224,
                height: 224,
              }
            : { status: 'none' },
          colors: {
            background: '#590019',
            text1: null,
            text2: null,
            text3: null,
            text4: null,
          },
        } satisfies AlbumPresentation,
      })
    })

    await page.route('**/api/motion/test-album-clip.mp4', route => route.fulfill({
      contentType: 'video/webm',
      body: clip,
    }))

    await boot(page)
    await expect.poll(() => requestedMotion).toBe(true)
    if (test.info().project.name === 'chromium') await expect(page.locator('.album-cover video.motion-art.is-ready')).toBeAttached()
    // WebKit cannot decode the WebM clip: the failure must leave the static cover in place.
    else await expect(page.locator('.album-cover video.motion-art')).toHaveCount(0)

    // Under reduced motion
    let reducedRequestedMotion: boolean | undefined
    await page.route('**/api/albums/presentation', route => {
      const body = route.request().postDataJSON()
      reducedRequestedMotion = body?.motion
      return route.fulfill({
        json: {
          motion: { status: 'none' },
          colors: {
            background: '#590019',
            text1: null,
            text2: null,
            text3: null,
            text4: null,
          },
        } satisfies AlbumPresentation,
      })
    })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/music/album/${testAlbum.id}?reduced=1`)
    await expect(importButton(page)).toBeEnabled()
    await expect.poll(() => reducedRequestedMotion).toBe(false)
    await expect(page.locator('.album-cover video.motion-art')).toHaveCount(0)
  })

  test('falls back to dominant colour when no Apple colours', async ({ page }) => {
    const expected = albumTint('#00FF00')

    await page.route('**/api/artwork/remote?*', route => route.fulfill({ contentType: 'image/png', body: greenCoverBuffer }))
    await page.route('**/api/albums/presentation', route => route.fulfill({
      json: {
        motion: { status: 'none' },
      } satisfies AlbumPresentation,
    }))

    await boot(page)
    const albumPage = page.locator('.album-page')
    await expect(albumPage).toBeVisible()

    await expect.poll(() => albumPage.evaluate(el => getComputedStyle(el).getPropertyValue('--album-bg').trim().toUpperCase())).toBe(expected.background)
  })
})
