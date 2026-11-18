import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { generateAudio } from '../helpers/audio'
import type { Library, Track } from '../../shared/types/music'
import { importButton, isPhone } from '../helpers/ui'

// Enhanced (A2) LRC: the first line carries per-word timing, the second does not.
const wordLyrics = '[00:00.00]<00:00.00>Primera <00:00.60>palabra <00:01.20>cantada<00:02.00>\n[00:03.00]Segunda línea\n[00:08.00]Tercera línea'
let directory: string, track: Track

async function importTrack(request: APIRequestContext, filename: string) {
  const path = join(directory, filename)
  generateAudio(path, { format: 'aac', duration: 20, frequency: 523, lyrics: wordLyrics })
  const response = await request.post(`/api/imports?filename=${encodeURIComponent(filename)}`, { data: await readFile(path), headers: { 'Content-Type': 'application/octet-stream' } })
  expect(response.status()).toBe(202)
  const job = await response.json()
  await expect.poll(async () => (await (await request.get('/api/imports')).json()).find((item: { id: string }) => item.id === job.id)?.state).toMatch(/complete|duplicate/)
  const library = await (await request.get('/api/library')).json() as Library
  return library.tracks.find(item => item.title === filename.replace('.m4a', ''))!
}

async function openExpanded(page: Page) {
  // Start from the default (artwork first) once; later reloads keep whatever the test chose.
  await page.addInitScript(() => { if (!sessionStorage.getItem('openfy-test-lyrics-reset')) { localStorage.removeItem('openfy-immersive-lyrics'); sessionStorage.setItem('openfy-test-lyrics-reset', '1') } })
  await page.goto('/library')
  await expect(importButton(page)).toBeEnabled()
  await page.getByRole('button', { name: `Reproducir ${track.title}`, exact: true }).click()
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
  return page.getByRole('dialog', { name: 'Reproductor ampliado' })
}

test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-immersive-e2e-'))
  track = await importTrack(request, 'Palabra por palabra.m4a')
})
test.afterAll(async () => {
  if (!directory) return
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true)
  await rm(directory, { recursive: true, force: true })
})

test.describe('expanded player', () => {
  test.use({ serviceWorkers: 'block' })

  test('shows the lyrics next to the song and lights each sung word', async ({ page }, info) => {
    const dialog = await openExpanded(page)
    await expect(dialog.locator('.ambient')).toHaveAttribute('data-ambient', /^(webgl|css)$/)
    // Wide screens always show the lyrics beside the song. The iPhone opens on the artwork and switches to the
    // lyrics with the lyrics button; there is no source label.
    if (isPhone(info)) {
      await expect(dialog.locator('.immersive-content')).toHaveAttribute('data-layout', 'cover')
      await expect(dialog.getByRole('region', { name: 'Letra de la canción', exact: true })).toHaveCount(0)
      const toggle = dialog.getByRole('button', { name: 'Letra en reproductor ampliado', exact: true })
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    } else await expect(dialog.getByRole('button', { name: 'Letra en reproductor ampliado' })).toHaveCount(0)
    await expect(dialog.getByText('De tu biblioteca', { exact: true })).toHaveCount(0)
    // Desktop Chrome (1440×1000) splits; with its lyrics on, the iPhone viewport stacks a compact header over them.
    await expect(dialog.locator('.immersive-content')).toHaveAttribute('data-layout', isPhone(info) ? 'stacked' : 'split')
    const lyrics = dialog.getByRole('region', { name: 'Letra de la canción', exact: true })
    await expect(dialog.locator('.immersive-artwork')).toBeVisible()
    await expect(lyrics).toBeVisible()
    await expect(dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' })).toBeVisible()
    if (info.project.name === 'chromium') {
      // Controls sit in a dock under both columns, below the bottom of the cover and the lyrics.
      const dock = await dialog.getByRole('button', { name: 'Pausar en reproductor ampliado' }).or(dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' })).boundingBox()
      const cover = await dialog.locator('.immersive-artwork').boundingBox(), panel = await dialog.locator('.immersive-lyrics').boundingBox()
      expect(dock!.y).toBeGreaterThan(cover!.y + cover!.height)
      expect(dock!.y).toBeGreaterThan(panel!.y + panel!.height)
      await expect(dialog.getByRole('slider', { name: 'Volumen en reproductor ampliado' })).toBeVisible()
    }
    await expect(lyrics.getByText('Letra sincronizada por palabra', { exact: true })).toBeVisible()
    // Nothing in the lyrics column (verses, attribution, "Seguir reproducción") may reach the seek bar or the transport.
    await lyrics.locator('.lyrics-scroll').dispatchEvent('wheel')
    await expect(lyrics.getByRole('button', { name: 'Seguir reproducción' })).toBeVisible()
    const bottoms = await dialog.locator('.immersive-lyrics').evaluate(region => Math.max(...[...region.querySelectorAll('.lyrics-view > *')].map(child => child.getBoundingClientRect().bottom)))
    const seek = (await dialog.locator('.immersive-seek').boundingBox())!
    expect(bottoms).toBeLessThanOrEqual(seek.y + 1)
    await lyrics.getByRole('button', { name: 'Seguir reproducción' }).click()
    await expect(lyrics).not.toContainText('<00:')

    await lyrics.getByRole('button', { name: 'Primera palabra cantada · 0:00', exact: true }).click()
    const words = lyrics.locator('.lyrics-line.current .lyrics-word')
    await expect(words).toHaveText(['Primera ', 'palabra ', 'cantada'])
    await expect(words.nth(0)).toHaveClass(/singing/)
    await dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' }).fill('1.4')
    await expect(words.nth(0)).toHaveClass(/sung/)
    await expect(words.nth(1)).toHaveClass(/sung/)
    await expect(words.nth(2)).toHaveClass(/singing/)

    // A line without word timing keeps the per-line highlight.
    await lyrics.getByRole('button', { name: 'Segunda línea · 0:03', exact: true }).click()
    await expect(lyrics.locator('.lyrics-line.current')).toHaveText('Segunda línea')
    await expect(lyrics.locator('.lyrics-line.current .lyrics-word')).toHaveCount(0)
  })

  test('keeps the CSS ambient when WebGL2 is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === 'webgl2' ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest)
      } as typeof original
    })
    const dialog = await openExpanded(page)
    await expect(dialog.locator('.ambient')).toHaveAttribute('data-ambient', 'css')
    await expect(dialog.locator('.ambient i')).toHaveCount(3)
    await expect(dialog.locator('.ambient-canvas')).toHaveCount(0)
  })
})
