import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { generateAudio } from '../helpers/audio'
import { importButton, isPhone } from '../helpers/ui'
import type { Library, Track } from '../../shared/types/music'

let directory: string, tracks: Track[]
test.beforeEach(({}, info) => test.skip(isPhone(info), 'Keyboard and mouse shortcuts are a desktop feature'))
test.beforeAll(async ({ request }, info) => {
  if (isPhone(info)) return
  directory = await mkdtemp(join(tmpdir(), 'openfy-shortcuts-'))
  tracks = []
  for (const [i, name] of ['Atajo primera', 'Atajo segunda'].entries()) {
    const filename = `${name}.m4a`, path = join(directory, filename)
    generateAudio(path, { duration: 40, format: 'aac', frequency: 320 + i * 90 })
    const response = await request.post(`/api/imports?filename=${encodeURIComponent(filename)}`, { data: await readFile(path), headers: { 'Content-Type': 'application/octet-stream' } })
    expect(response.status()).toBe(202)
    await expect.poll(async () => ((await (await request.get('/api/library')).json()) as Library).tracks.some(t => t.title === name)).toBe(true)
    tracks.push(((await (await request.get('/api/library')).json()) as Library).tracks.find(t => t.title === name)!)
  }
})
test.afterAll(async () => {
  if (!directory) return
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true)
  await rm(directory, { recursive: true, force: true })
})

/** A restored two-song queue, paused at the start, at half volume. */
async function open(page: Page) {
  await page.goto('/library')
  await expect(importButton(page)).toBeEnabled()
  await page.evaluate(async tracks => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('openfy'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const queue = tracks.map((track, i) => ({ source: 'local', trackId: track.id, queueId: `shortcut-${i}` }))
    const tx = db.transaction('snapshots', 'readwrite')
    tx.objectStore('snapshots').put({ key: 'playback', value: { version: 3, queue, originalOrder: queue.map(e => e.queueId), index: 0, position: 0, volume: 0.5, repeat: 'off', shuffle: false } })
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close()
  }, tracks)
  await page.reload()
  await expect(page.locator('.player-bar, footer').getByText('Atajo primera').first()).toBeVisible()
  // Start from an inert target, as after clicking the page background.
  await page.locator('main').first().click({ position: { x: 5, y: 5 } })
}
const volume = (page: Page) => page.getByRole('slider', { name: 'Volumen', exact: true }).first()
const sideButton = (page: Page, button: 3 | 4) => page.evaluate(button => {
  for (const type of ['mousedown', 'mouseup']) window.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }))
}, button)

test('controls playback from the keyboard', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await page.keyboard.press('k')
  await expect(page.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible()

  await page.keyboard.press('Control+ArrowUp')
  await expect(volume(page)).toHaveValue('0.6')
  await page.keyboard.press('Control+ArrowDown')
  await page.keyboard.press('Control+ArrowDown')
  await expect(volume(page)).toHaveValue('0.4')
  await page.keyboard.press('m')
  await expect(volume(page)).toHaveValue('0')
  await expect(page.getByRole('status').filter({ hasText: 'Sonido silenciado' })).toBeAttached()
  await page.keyboard.press('m')
  await expect(volume(page)).toHaveValue('0.4')

  await page.keyboard.press('a')
  await expect(page.getByRole('button', { name: 'Reproducción aleatoria', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('a')
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: 'Repetición: toda la cola', exact: true })).toBeVisible()

  await page.keyboard.press('Control+ArrowRight')
  await expect(page.locator('.player-bar, footer').getByText('Atajo segunda').first()).toBeVisible()
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(() => page.getByRole('slider', { name: 'Posición de reproducción', exact: true }).inputValue().then(Number)).toBeGreaterThanOrEqual(9)
  await page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(() => page.getByRole('slider', { name: 'Posición de reproducción', exact: true }).inputValue().then(Number)).toBeLessThan(5)
})

test('opens the panels, the search and Big Picture', async ({ page }) => {
  await open(page)
  await page.keyboard.press('c')
  await expect(page.getByRole('button', { name: 'Mostrar cola', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('l')
  await expect(page.getByRole('complementary', { name: 'Letras', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Letras', exact: true })).toHaveCount(0)

  await page.keyboard.press('Control+k')
  const search = page.getByRole('textbox', { name: 'Buscar en YouTube Music' })
  await expect(search).toBeFocused()
  // Letters type while editing: no shortcut fires.
  await page.keyboard.type('kma')
  await expect(search).toHaveValue('kma')
  await expect(page.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible()
  await expect(volume(page)).toHaveValue('0.5')
  await search.fill('')
  await page.goBack()
  await page.locator('main').first().click({ position: { x: 5, y: 5 } })

  await page.keyboard.press('b')
  const dialog = page.getByRole('dialog', { name: 'Reproductor ampliado' })
  await expect(dialog).toBeVisible()
  // Playback shortcuts keep working inside the expanded player.
  await page.keyboard.press('Control+ArrowUp')
  await expect(page.getByRole('slider', { name: 'Volumen', exact: true }).last()).toHaveValue('0.6')
  // The mouse back button closes it and keeps the page underneath.
  const before = page.url()
  await sideButton(page, 3)
  await expect(dialog).toHaveCount(0)
  expect(page.url()).toBe(before)
  await page.keyboard.press('b')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('b')
  await expect(dialog).toHaveCount(0)
})

test('lists the shortcuts in Ajustes', async ({ page }) => {
  await page.goto('/settings')
  const guide = page.getByRole('region', { name: 'Atajos de teclado' })
  await expect(guide).toBeVisible()
  await expect(guide.getByText('Abrir o cerrar Big Picture')).toBeVisible()
  await expect(guide.locator('kbd', { hasText: 'F11' })).toBeVisible()
})
