import { test, expect, type Page } from '@playwright/test'
import session from '../fixtures/appearance-session.json' with { type: 'json' }

async function exportSession(page: Page, path?: string) {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar sesión de escritorio' }).click()
  const file = await download
  if (path) await file.saveAs(path)
  const stream = await file.createReadStream(), chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString())
}

for (const previous of [null, 'false', 'true']) {
  test(`migrates the ${previous ?? 'absent'} design preference and round-trips an old session`, async ({ page }, info) => {
    await page.addInitScript(previous => {
      if (previous !== null) localStorage.setItem('openfy-new-design', previous)
      localStorage.setItem('openfy-motion', 'off')
      localStorage.setItem('openfy-preserve', 'existing preference')
    }, previous)
    await page.goto('/settings')
    const motion = page.getByRole('checkbox', { name: 'Activar movimiento ambiental' }).or(page.getByRole('switch', { name: 'Activar movimiento ambiental' }))
    await expect(motion).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Nuevo diseño' })).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-design')
    await expect.poll(() => page.locator('.player-bar').evaluate(bar => parseFloat(getComputedStyle(bar).borderTopLeftRadius))).toBeGreaterThanOrEqual(16)
    expect(await page.evaluate(() => [localStorage.getItem('openfy-new-design'), localStorage.getItem('openfy-preserve')])).toEqual([null, 'existing preference'])
    const imported = { ...session, preferences: { ...session.preferences, ...(previous === null ? {} : { newDesign: previous === 'true' }) } }
    const input = page.locator('input[type="file"][accept=".json,application/json"]')
    await input.setInputFiles({ name: 'old-session.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) })
    await expect(page.getByRole('button', { name: 'Abrir reproductor ampliado' })).toContainText('Seleccionada')
    await expect(page.getByTestId('audio-engine')).toHaveJSProperty('volume', .42)
    await expect(page.getByTestId('audio-engine')).toHaveJSProperty('paused', true)
    const exported = await exportSession(page, info.outputPath('web-session.json'))
    expect(exported.version).toBe(1)
    expect(exported.preferences).toEqual(session.preferences)
    expect(exported.playback).toEqual(session.playback)
    await input.setInputFiles({ name: 'round-trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
    await page.reload()
    await expect(motion).not.toBeChecked()
    await expect(page.locator('html')).not.toHaveAttribute('data-design')
    expect((await exportSession(page)).playback).toEqual(session.playback)
  })
}

test('keeps the presentation usable when appearance storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method]
      Object.defineProperty(Storage.prototype, method, { value: function (this: Storage, key: string, ...args: string[]) {
        if (key === 'openfy-new-design' || key === 'openfy-motion') throw new DOMException('Unavailable', 'SecurityError')
        return (original as (...args: string[]) => unknown).apply(this, [key, ...args])
      } })
    }
  })
  await page.goto('/settings')
  const motion = page.getByRole('checkbox', { name: 'Activar movimiento ambiental' }).or(page.getByRole('switch', { name: 'Activar movimiento ambiental' }))
  await expect(motion).toBeChecked()
  await motion.press('Space')
  await expect(page.locator('html')).toHaveClass(/reduce-motion/)
  await expect(page.locator('html')).not.toHaveAttribute('data-design')
  await expect.poll(() => page.locator('.player-bar').evaluate(bar => parseFloat(getComputedStyle(bar).borderTopLeftRadius))).toBeGreaterThanOrEqual(16)
})
