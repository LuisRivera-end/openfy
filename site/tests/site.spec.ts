import { test, expect, type Page } from '@playwright/test'

const release = {
  tag_name: 'v9.8.7-build.123',
  html_url: 'https://github.com/LuisRivera-end/openfy/releases/tag/v9.8.7-build.123',
  published_at: '2026-11-18T07:11:38Z',
  assets: [
    { name: 'Openfy-9.8.7-123-release.apk', size: 52428800, browser_download_url: 'https://example.test/Openfy-9.8.7-123-release.apk' },
    { name: 'openfy-android-update.json', size: 900, browser_download_url: 'https://example.test/openfy-android-update.json' },
    { name: 'Openfy-Setup-9.8.7-123-x64.exe', size: 157286400, browser_download_url: 'https://example.test/Openfy-Setup-9.8.7-123-x64.exe' },
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
  for (const id of ['features', 'library', 'lyrics', 'offline', 'big-picture', 'privacy', 'how', 'download', 'news']) await expect(page.locator(`#${id}`)).toHaveCount(1)
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
  await expect(download.locator('a[href="https://example.test/SHA256SUMS.txt"]').first()).toBeAttached()
  await expect(download).toContainText('9.8.7')
})

test('download buttons fall back to the releases page when GitHub is unreachable', async ({ page }) => {
  await page.route(API, route => route.abort())
  await page.goto('/')
  const download = page.locator('#download')
  await expect(download.locator('a[href="https://github.com/LuisRivera-end/openfy/releases/latest"]')).toHaveCount(2)
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
