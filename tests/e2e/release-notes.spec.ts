import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const metadata = read('../../package.json') as { version: string }
const notes = read('../../shared/release-notes.json') as { releases: { version: string, items: { text: string }[] }[] }

const current = notes.releases.find(release => release.version === metadata.version)!
const novedades = (page: Page) => page.getByRole('dialog', { name: 'Novedades' })

test.describe('a device without a recorded version', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('shows the current version once and remembers it after closing', async ({ page }) => {
    await page.goto('/')
    const dialog = novedades(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: `Versión ${metadata.version}` })).toBeVisible()
    await expect(dialog.getByRole('listitem')).toHaveCount(current.items.length)
    await expect(dialog.getByText(current.items[0]!.text)).toBeVisible()
    await expect(dialog.getByText('Esto es lo nuevo desde')).toHaveCount(0)
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    await dialog.getByRole('button', { name: 'Entendido' }).click()
    await expect(dialog).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('openfy-release-seen'))).toBe(metadata.version)
    await page.reload()
    await expect(page.locator('#main')).toBeFocused()
    await page.waitForTimeout(400)
    await expect(dialog).toBeHidden()
  })
})

test('an older recorded version shows the new notes and Ajustes reopens the history', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('qa-release-seeded')) { localStorage.setItem('openfy-release-seen', '0.0.1'); sessionStorage.setItem('qa-release-seeded', '1') } })
  await page.goto('/settings')
  const dialog = novedades(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: `Versión ${metadata.version}` })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cerrar diálogo' }).click()
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('openfy-release-seen'))).toBe(metadata.version)
  await page.getByRole('button', { name: 'Novedades', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveCount(notes.releases.length)
  await dialog.getByRole('button', { name: 'Entendido' }).click()
  await expect(dialog).toBeHidden()
})
