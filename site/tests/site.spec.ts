import { test, expect, type Page } from '@playwright/test'

const release = {
  tag_name: 'v9.8.7-build.123',
  html_url: 'https://github.com/LuisRivera-end/openfy/releases/tag/v9.8.7-build.123',
  published_at: '2026-11-18T07:11:38Z',
  assets: [
    { name: 'Openfy-9.8.7-123-release.apk', size: 52428800, browser_download_url: 'https://example.test/Openfy-9.8.7-123-release.apk' },
    { name: 'openfy-android-update.json', size: 900, browser_download_url: 'https://example.test/openfy-android-update.json' },
    { name: 'Openfy-Setup-9.8.7-123-x64.exe', size: 157286400, browser_download_url: 'https://example.test/Openfy-Setup-9.8.7-123-x64.exe' },
    { name: 'Openfy-9.8.7-123-linux-x64.tar.gz', size: 104857600, browser_download_url: 'https://example.test/Openfy-9.8.7-123-linux-x64.tar.gz' },
    { name: 'Openfy-9.8.7-123-linux-arm64.tar.gz', size: 99614720, browser_download_url: 'https://example.test/Openfy-9.8.7-123-linux-arm64.tar.gz' },
    { name: 'SHA256SUMS.txt', size: 300, browser_download_url: 'https://example.test/SHA256SUMS.txt' }
  ]
}

const API = 'https://api.github.com/repos/LuisRivera-end/openfy/releases/latest'
const mockRelease = (page: Page) => page.route(API, route => route.fulfill({ json: release }))

test('Spanish page renders the hero and links to English', async ({ page }) => {
  await mockRelease(page)
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.locator('#hero-title')).toContainText('Toda tu música')
  await expect(page.locator('.nav-lang')).toHaveAttribute('href', './en/')
  for (const id of ['features', 'library', 'lyrics', 'offline', 'big-picture', 'privacy', 'how', 'download', 'faq', 'news']) await expect(page.locator(`#${id}`)).toHaveCount(1)
})

test('English page uses the English dictionary', async ({ page }) => {
  await mockRelease(page)
  await page.goto('/en/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page).toHaveTitle(/Your music/)
  await expect(page.locator('#hero-title')).toContainText('All your music')
})

test('download buttons resolve the latest release assets', async ({ page }) => {
  await mockRelease(page)
  await page.goto('/')
  const download = page.locator('#download')
  await expect(download.locator('a[href="https://example.test/Openfy-Setup-9.8.7-123-x64.exe"]')).toHaveCount(1)
  await expect(download.locator('a[href="https://example.test/Openfy-9.8.7-123-release.apk"]')).toHaveCount(1)
  await expect(download.locator('.download-btn-linux')).toHaveAttribute('href', 'https://example.test/Openfy-9.8.7-123-linux-x64.tar.gz')
  await expect(download.locator('a[href="https://example.test/Openfy-9.8.7-123-linux-arm64.tar.gz"]')).toHaveCount(1)
  await expect(download.locator('a[href="https://example.test/SHA256SUMS.txt"]').first()).toBeAttached()
  await expect(download).toContainText('9.8.7')
})

test('download buttons fall back to the releases page when GitHub is unreachable', async ({ page }) => {
  await page.route(API, route => route.abort())
  await page.goto('/')
  const download = page.locator('#download')
  await expect(download.locator('a[href="https://github.com/LuisRivera-end/openfy/releases/latest"]')).toHaveCount(3)
  await expect(download).toContainText('No se pudo conectar con GitHub')
})

test('reduced motion shows every sequence step without pinning', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockRelease(page)
  await page.goto('/')
  await expect(page.locator('#features')).not.toHaveClass(/is-pinned/)
  for (const step of await page.locator('.seq-step').all()) {
    await step.scrollIntoViewIfNeeded()
    await expect(step).toBeVisible()
    expect(await step.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  }
})

test('a visible animated cover plays', async ({ page }) => {
  test.skip(test.info().project.name !== 'chromium')
  await mockRelease(page)
  await page.goto('/')
  const video = page.locator('#big-picture .motion-video')
  await video.scrollIntoViewIfNeeded()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.3)
  await expect(video).toHaveClass(/\bis-playing\b/)

  await page.setViewportSize({ width: 390, height: 844 })
  const phoneVideo = page.locator('.seq-shot .sp-cover > .motion-video')
  await phoneVideo.scrollIntoViewIfNeeded()
  await expect.poll(() => phoneVideo.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.3)
  const radius = await phoneVideo.evaluate(element => getComputedStyle(element.parentElement!).borderTopLeftRadius)
  await expect(phoneVideo).toHaveCSS('clip-path', `inset(0px round ${radius})`)
})

test('reduced motion never plays animated covers', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockRelease(page)
  await page.goto('/')
  const videos = page.locator('.motion-video')
  await expect(videos.first()).toBeAttached()
  for (const video of await videos.all()) {
    if (!await video.isVisible()) continue
    await video.scrollIntoViewIfNeeded()
    await expect(video).toBeInViewport({ ratio: 0.35 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  expect(await videos.evaluateAll(elements => elements.every(video =>
    (video as HTMLVideoElement).paused && !video.hasAttribute('src')
  ))).toBe(true)
})

test('the page never scrolls horizontally', async ({ page }) => {
  await mockRelease(page)
  await page.goto('/')
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < height; y += 700) {
    await page.evaluate(top => window.scrollTo(0, top), y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  }
})

test('no console errors while scrolling through the page', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await mockRelease(page)
  await page.goto('/')
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < height; y += 900) await page.evaluate(top => window.scrollTo(0, top), y)
  expect(errors).toEqual([])
})

test('an Android-only release sends the Windows button to the release history', async ({ page }) => {
  const androidOnly = { ...release, assets: release.assets.filter(asset => !asset.name.endsWith('.exe')) }
  await page.route(API, route => route.fulfill({ json: androidOnly }))
  await page.goto('/')
  const windows = page.locator('#download .download-btn-windows')
  await expect(windows).toHaveAttribute('href', 'https://github.com/LuisRivera-end/openfy/releases')
  await expect(windows).toContainText('Todas las versiones')
  await expect(page.locator('#download .download-btn-android')).toHaveAttribute('href', 'https://example.test/Openfy-9.8.7-123-release.apk')
})

test('the scroll hint never overlaps the hero buttons', async ({ page }) => {
  test.skip(test.info().project.name !== 'chromium')
  await mockRelease(page)
  for (const viewport of [
    { width: 1280, height: 660 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 }
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.waitForTimeout(1800)
    const hint = await page.locator('.hero-scroll').boundingBox()
    const ctas = await page.locator('.hero-ctas').boundingBox()
    if (hint && hint.height > 0) {
      expect(ctas).not.toBeNull()
      expect(hint.y).toBeGreaterThanOrEqual(ctas!.y + ctas!.height + 8)
    }
  }
})

test('FAQ section renders items and accordion opens on click', async ({ page }) => {
  await mockRelease(page)
  await page.goto('/')
  const faq = page.locator('#faq')
  await expect(faq).toHaveCount(1)

  const items = faq.locator('.faq-item')
  await expect(items).toHaveCount(8)

  await faq.scrollIntoViewIfNeeded()
  await expect(faq.locator('#faq-title')).toBeVisible()

  // Verify initial state: no item is open
  const firstItem = items.first()
  await expect(firstItem).not.toHaveAttribute('open', '')

  // Clicking summary opens the details and reveals answer
  const firstSummary = firstItem.locator('.faq-summary')
  await firstSummary.click()
  await expect(firstItem).toHaveAttribute('open', '')
  await expect(firstItem.locator('.faq-answer')).toBeVisible()
  await expect(firstItem.locator('.faq-answer-text')).not.toBeEmpty()

  // Clicking again closes it
  await firstSummary.click()
  await expect(firstItem).not.toHaveAttribute('open', '')
})

test.describe('breakpoint changes', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop viewport only')

  for (const [name, change] of [
    ['shrinking to phone width', (page: Page) => page.setViewportSize({ width: 700, height: 800 })],
    ['enabling reduced motion', (page: Page) => page.emulateMedia({ reducedMotion: 'reduce' })]
  ] as const) {
    test(`${name} keeps the reader inside the pinned sequence`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await mockRelease(page)
      await page.goto('/')
      await page.waitForTimeout(800)
      await page.evaluate(() => { const el = document.getElementById('features')!; window.scrollTo(0, el.getBoundingClientRect().top + scrollY + 1500) })
      await page.waitForTimeout(800)
      await change(page)
      await page.waitForTimeout(1200)
      const rect = await page.locator('#features').evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, pinned: el.classList.contains('is-pinned') } })
      expect(rect.pinned).toBe(false)
      expect(rect.top).toBeLessThanOrEqual(1)
      expect(rect.bottom).toBeGreaterThan(0)
    })
  }
})
