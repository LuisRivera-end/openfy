import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { generateAudio } from '../helpers/audio'
import type { Library, Track } from '../../shared/types/music'
import { importButton, isPhone } from '../helpers/ui'

// The phone shell (docs/mobile-ux.md). Emulated WebKit reports 0 px safe areas, so the Dynamic Island is simulated
// through the --safe-* tokens the CSS reads; a physical iPhone check is still listed in the docs.
let directory: string, tracks: Track[] = [], playlistId = ''
const titles = ['Mañana clara', 'Brisa lenta', 'Camino norte']

async function importTrack(request: APIRequestContext, title: string, frequency: number) {
  const filename = `${title}.m4a`, path = join(directory, filename)
  generateAudio(path, { format: 'aac', duration: 30, frequency })
  const response = await request.post(`/api/imports?filename=${encodeURIComponent(filename)}`, { data: await readFile(path), headers: { 'Content-Type': 'application/octet-stream' } })
  expect(response.status()).toBe(202)
  const job = await response.json()
  await expect.poll(async () => (await (await request.get('/api/imports')).json()).find((item: { id: string }) => item.id === job.id)?.state).toMatch(/complete|duplicate/)
  const library = await (await request.get('/api/library')).json() as Library
  return library.tracks.find(item => item.title === title)!
}
async function boot(page: Page, path: string) {
  await page.goto(path)
  await expect(importButton(page)).toBeEnabled()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0)
  await page.evaluate(() => { document.documentElement.style.setProperty('--safe-top', '59px'); document.documentElement.style.setProperty('--safe-bottom', '34px') })
}
/** Pointer events as a finger would send them; Playwright's mouse reports pointerType "mouse". */
async function touch(page: Page, selector: string, type: string, x: number, y: number) {
  await page.locator(selector).first().dispatchEvent(type, { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true })
}

test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-mobile-e2e-'))
  tracks = []
  for (const [i, title] of titles.entries()) tracks.push(await importTrack(request, title, 330 + i * 40))
  const created = await request.post('/api/playlists', { data: { name: 'Ruta del teléfono' } })
  const playlist = await created.json()
  playlistId = playlist.id
  expect((await request.put(`/api/playlists/${playlistId}`, { data: { name: playlist.name, trackIds: tracks.map(track => track.id), revision: playlist.revision } })).ok()).toBe(true)
})
test.afterAll(async () => {
  if (!directory) return
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true)
  await rm(directory, { recursive: true, force: true })
})

test.describe('phone shell', () => {
  test.use({ serviceWorkers: 'block' })
  test.beforeEach(async ({}, info) => { test.skip(!isPhone(info), 'Phone layout only') })

  test('fits the screen below the Dynamic Island with 16 px fields and 44 px targets', async ({ page }) => {
    await boot(page, '/library')
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark')
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => { const rect = document.querySelector(selector)!.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height } }
      const fields = [...document.querySelectorAll<HTMLElement>('input:not([type="checkbox"]):not([type="range"]):not([type="file"]), select')].filter(field => field.getClientRects().length).map(field => parseFloat(getComputedStyle(field).fontSize))
      const targets = [...document.querySelectorAll<HTMLElement>('.mobile-nav a, .topbar .avatar, .track-row .icon-button, .library-heading-actions button')].filter(element => element.getClientRects().length)
        .map(element => { const rect = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') || element.textContent?.trim(), width: rect.width, height: rect.height } })
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, brand: box('.mobile-brand'), backdrop: box('.status-backdrop'), fields, targets }
    })
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width)
    // iOS 26/27 blur: a solid strip at least 6 px tall, full width, at the very top keeps the status bar opaque.
    expect(geometry.backdrop.top).toBe(0)
    expect(geometry.backdrop.height).toBeGreaterThanOrEqual(59)
    expect(geometry.backdrop.width).toBe(geometry.width)
    expect(geometry.brand.top).toBeGreaterThanOrEqual(59)
    expect(geometry.fields.length).toBeGreaterThan(0)
    for (const size of geometry.fields) expect(size).toBeGreaterThanOrEqual(16)
    for (const target of geometry.targets) { expect(target.width, target.label).toBeGreaterThanOrEqual(44); expect(target.height, target.label).toBeGreaterThanOrEqual(44) }
    // Nothing is playing yet, so the mini player is not shown.
    await expect(page.locator('.player-bar')).toBeHidden()
    await expect(page.getByRole('navigation', { name: 'Navegación móvil' }).getByRole('link', { name: 'Tu biblioteca' })).toHaveClass(/current/)
  })

  test('opens song options as a bottom sheet that ignores taps on its own padding', async ({ page }) => {
    await boot(page, '/library')
    await page.getByRole('button', { name: `Opciones de ${titles[0]}`, exact: true }).click()
    const sheet = page.getByRole('dialog', { name: titles[0] })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Ir al álbum', exact: true })).toBeVisible()
    const box = (await sheet.boundingBox())!
    const viewport = page.viewportSize()!
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 1)
    expect(Math.round(box.width)).toBe(viewport.width)
    await page.mouse.click(box.x + 6, box.y + box.height / 2)
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Cerrar diálogo', exact: true }).click()
    await expect(sheet).toBeHidden()
  })

  test('long press opens the options and dragging the sheet down closes it', async ({ page }) => {
    await boot(page, '/library')
    const row = page.getByRole('listitem').filter({ hasText: titles[1] })
    const rect = (await row.boundingBox())!
    const selector = `.track-row:has-text("${titles[1]}")`
    await touch(page, selector, 'pointerdown', rect.x + 120, rect.y + 20)
    await page.waitForTimeout(650)
    await touch(page, selector, 'pointerup', rect.x + 120, rect.y + 20)
    const sheet = page.getByRole('dialog', { name: titles[1] })
    await expect(sheet).toBeVisible()
    const handle = (await sheet.locator('.sheet-handle').boundingBox())!
    const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2
    await touch(page, 'dialog[open] .sheet-handle', 'pointerdown', x, y)
    await touch(page, 'dialog[open] .sheet-handle', 'pointermove', x, y + 60)
    await touch(page, 'dialog[open] .sheet-handle', 'pointermove', x, y + 140)
    await touch(page, 'dialog[open] .sheet-handle', 'pointerup', x, y + 140)
    await expect(sheet).toBeHidden()
  })

  test('sorts from a sheet and reaches playlists and the most played from the library', async ({ page }) => {
    await boot(page, '/library')
    await page.getByRole('button', { name: /^Ordenar: / }).click()
    await page.getByRole('dialog', { name: 'Ordenar canciones' }).getByRole('button', { name: 'Título', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Ordenar: Título' })).toBeVisible()
    // The suite shares one library; compare the order of this spec's songs among the rest.
    await expect.poll(async () => (await page.locator('.track-title').allTextContents()).filter(title => titles.includes(title))).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'es')))
    await page.getByRole('button', { name: /^Ordenar: / }).click()
    await page.getByRole('dialog', { name: 'Ordenar canciones' }).getByRole('button', { name: 'Añadidas recientemente', exact: true }).click()
    await expect(page.getByRole('link', { name: /Más reproducidas/ })).toBeVisible()
    await page.locator('.filter-chips').getByRole('button', { name: 'Playlists', exact: true }).click()
    // Each project's run creates its own copy of the playlist in the shared library.
    await page.getByRole('link', { name: /Ruta del teléfono/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Ruta del teléfono', exact: true })).toBeVisible()
    // The detail keeps the tab it was opened from and offers a real Back.
    await expect(page.getByRole('navigation', { name: 'Navegación móvil' }).getByRole('link', { name: 'Tu biblioteca' })).toHaveClass(/current/)
    await page.getByRole('button', { name: 'Volver a Tu biblioteca', exact: true }).click()
    await expect(page).toHaveURL(/\/library$/)
    // The filter row stays on phones: «Solo descargadas» matters most without a connection.
    await page.goto(`/playlist/${playlistId}`)
    await expect(page.getByRole('textbox', { name: 'Filtrar canciones', exact: true })).toBeVisible()
  })

  test('the expanded player opens on the artwork, remembers lyrics, keeps the queue over it and closes with Back', async ({ page }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem('openfy-test-lyrics-reset')) { localStorage.removeItem('openfy-immersive-lyrics'); sessionStorage.setItem('openfy-test-lyrics-reset', '1') } })
    await boot(page, '/library')
    await page.locator('.track-row').filter({ hasText: titles[2] }).locator('.track-title').click()
    await page.getByRole('button', { name: 'Pausar', exact: true }).click()
    await expect(page.locator('.player-bar')).toBeVisible()
    await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
    const player = page.getByRole('dialog', { name: 'Reproductor ampliado' })
    await expect(player.locator('.immersive-content')).toHaveAttribute('data-layout', 'cover')
    await expect(page).toHaveURL(/overlay=player/)
    // A saved song shows a filled heart, not only a green outline.
    const heart = player.getByRole('button', { name: 'Marcar favorito', exact: true })
    const fill = () => heart.locator('svg').evaluate(icon => getComputedStyle(icon).fill)
    if (await heart.getAttribute('aria-pressed') === 'true') await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'false')
    expect(await fill()).toBe('none')
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(fill).not.toBe('none')
    await player.getByRole('button', { name: 'Letra en reproductor ampliado', exact: true }).click()
    await expect(player.locator('.immersive-content')).toHaveAttribute('data-layout', 'stacked')
    await player.getByRole('button', { name: 'Cerrar reproductor ampliado', exact: true }).click()
    await expect(player).toBeHidden()
    await expect(page).toHaveURL(/\/library$/)
    await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
    await expect(player.locator('.immersive-content')).toHaveAttribute('data-layout', 'stacked')
    await player.getByRole('button', { name: 'Abrir cola desde reproductor ampliado', exact: true }).click()
    const queue = page.getByRole('dialog', { name: 'Cola de reproducción' })
    await expect(queue.getByText('Sonando ahora')).toBeVisible()
    await expect(player).toBeVisible()
    await queue.getByRole('button', { name: 'Cerrar diálogo', exact: true }).click()
    await page.goBack()
    await expect(player).toBeHidden()
    await expect(page).toHaveURL(/\/library$/)
    await expect(page.getByRole('heading', { name: 'Tu biblioteca', exact: true })).toBeVisible()
  })

  test('the ambient background draws at most 30 frames per second on touch screens', async ({ page }) => {
    await page.addInitScript(() => {
      const counter = window as unknown as { openfyDraws: number }
      counter.openfyDraws = 0
      const original = WebGL2RenderingContext.prototype.drawArrays
      WebGL2RenderingContext.prototype.drawArrays = function (this: WebGL2RenderingContext, ...args: Parameters<typeof original>) { counter.openfyDraws++; return original.apply(this, args) }
    })
    await boot(page, '/library')
    test.skip(!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)), 'This WebKit build does not report a coarse pointer')
    await page.getByRole('button', { name: `Reproducir ${titles[1]}`, exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
    const player = page.getByRole('dialog', { name: 'Reproductor ampliado' })
    test.skip(await player.locator('.ambient').getAttribute('data-ambient') !== 'webgl', 'WebGL2 is unavailable in this browser build')
    await page.waitForTimeout(1000)
    const drawn = await page.evaluate(async () => {
      const counter = window as unknown as { openfyDraws: number }
      const start = counter.openfyDraws
      await new Promise(resolve => setTimeout(resolve, 2000))
      return counter.openfyDraws - start
    })
    expect(drawn).toBeGreaterThan(20)
    expect(drawn).toBeLessThanOrEqual(66)
  })

  test('settings lead with updates and fold the diagnostics away', async ({ page }) => {
    await boot(page, '/settings')
    const headings = await page.locator('.page-content h1, .page-content h2').allTextContents()
    expect(headings.slice(0, 3)).toEqual(['Ajustes', 'Actualizaciones', 'Tu biblioteca personal'])
    expect(headings.indexOf('Aplicación para Windows')).toBeGreaterThan(headings.indexOf('Reproducción y apariencia'))
    await expect(page.locator('details.validation-panel')).not.toHaveAttribute('open', '')
    await expect(page.getByRole('button', { name: 'Exportar diagnóstico' })).toBeHidden()
  })
})

test('keeps the mini player above the tab bar between 701 and 760 px', async ({ page }, info) => {
  test.skip(isPhone(info), 'Desktop browser resized into the tablet band')
  await page.setViewportSize({ width: 740, height: 900 })
  await page.goto('/library')
  await expect(importButton(page)).toBeEnabled()
  await page.getByRole('button', { name: `Reproducir ${titles[0]}`, exact: true }).click()
  await page.getByRole('button', { name: 'Pausar', exact: true }).first().click()
  // Reaching a row can compact the dock after scrolling; compare the expanded layout.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect(page.locator('.app-shell')).not.toHaveClass(/dock-compact/)
  await expect.poll(async () => {
    const bar = (await page.locator('.player-bar').boundingBox())!, nav = (await page.locator('.mobile-nav').boundingBox())!
    return bar.y + bar.height - nav.y
  }).toBeLessThanOrEqual(0)
})
