import { test, expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import ffmpeg from 'ffmpeg-static'
import { generateAudio } from '../helpers/audio'
import { importButton, isPhone } from '../helpers/ui'
import type { Library, Track } from '../../shared/types/music'

// The server runs with OPENFY_MOTION_ART=off: every answer here is simulated and nothing reaches the provider.
const KEY = 'a'.repeat(64)
let directory: string, tracks: Track[], video: Buffer
test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-motion-art-'))
  tracks = []
  for (const [i, name] of ['Portada animada uno', 'Portada animada dos'].entries()) {
    const filename = `${name}.m4a`, path = join(directory, filename)
    generateAudio(path, { duration: 20, format: 'aac', frequency: 280 + i * 90, album: `Álbum animado ${i + 1}` })
    const response = await request.post(`/api/imports?filename=${encodeURIComponent(filename)}`, { data: await readFile(path), headers: { 'Content-Type': 'application/octet-stream' } })
    expect(response.status()).toBe(202)
    await expect.poll(async () => ((await (await request.get('/api/library')).json()) as Library).tracks.some(t => t.title === name)).toBe(true)
    tracks.push(((await (await request.get('/api/library')).json()) as Library).tracks.find(t => t.title === name)!)
  }
  // VP8 plays in every Chromium build; the page does not depend on the container.
  const clip = join(directory, 'clip.webm')
  const made = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=96x96:rate=12', '-t', '1', '-c:v', 'libvpx', '-an', clip], { windowsHide: true })
  if (made.status !== 0) throw new Error(made.stderr.toString())
  video = await readFile(clip)
})
test.afterAll(async () => {
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true)
  await rm(directory, { recursive: true, force: true })
})

/** The first imported song has a video; every other album has none. */
async function simulate(page: Page) {
  const requests: unknown[] = []
  await page.route('**/api/motion/resolve', async route => {
    const body = route.request().postDataJSON()
    requests.push(body)
    await route.fulfill({ json: body.entry.trackId === tracks[0]!.id ? { status: 'ready', url: `/api/motion/${KEY}.mp4`, width: 96, height: 96 } : { status: 'none' } })
  })
  await page.route(`**/api/motion/${KEY}.mp4`, route => route.fulfill({ body: video, contentType: 'video/webm' }))
  return requests
}
async function open(page: Page) {
  await page.goto('/library')
  await expect(importButton(page)).toBeEnabled()
  await page.evaluate(async tracks => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('openfy'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const queue = tracks.map((track, i) => ({ source: 'local', trackId: track.id, queueId: `motion-art-${i}` }))
    const tx = db.transaction('snapshots', 'readwrite')
    tx.objectStore('snapshots').put({ key: 'playback', value: { version: 3, queue, originalOrder: queue.map(e => e.queueId), index: 0, position: 0, volume: 0, repeat: 'off', shuffle: false } })
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close()
  }, tracks)
  await page.reload()
  await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
  return page.getByRole('dialog', { name: 'Reproductor ampliado' })
}

test.describe('Motion art', () => {
  test.use({ serviceWorkers: 'block' })

  for (const status of ['unmatched', 'none', 'failed'] as const) {
    test(`retries ${status} after its deadline while the same album stays visible`, async ({ page }, info) => {
      test.skip(isPhone(info), 'Desktop only')
      let calls = 0
      await page.route('**/api/motion/resolve', route => {
        calls++
        if (calls === 1) return route.fulfill(status === 'failed'
          ? { status: 503, json: { message: 'Temporal', data: { retryAfterMs: 1500 } } }
          : { json: { status, retryAfterMs: 1500 } })
        return route.fulfill({ json: { status: 'ready', url: `/api/motion/${KEY}.mp4`, width: 96, height: 96 } })
      })
      await page.route(`**/api/motion/${KEY}.mp4`, route => route.fulfill({ body: video, contentType: 'video/webm' }))
      const dialog = await open(page), motion = dialog.locator('.immersive-artwork .motion-art')
      await expect.poll(() => calls).toBe(1)
      await expect(motion).toHaveCount(0)
      await expect(motion).toHaveCount(1)
      expect(calls).toBe(2)
    })
  }

  test('replaces the cover with the looping video on desktop, and never asks on the phone', async ({ page }, info) => {
    const requests = await simulate(page)
    const dialog = await open(page), motion = dialog.locator('.immersive-artwork .motion-art')
    if (isPhone(info)) {
      await expect(dialog.locator('.immersive-artwork')).toBeVisible()
      await page.waitForTimeout(1200)
      expect(requests).toHaveLength(0)
      await expect(motion).toHaveCount(0)
      return
    }
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0]).toEqual({ entry: { source: 'local', trackId: tracks[0]!.id } })
    // Paused: the static cover stays in front until the video is really playing.
    await expect(motion).toHaveCount(1)
    await expect(motion).not.toHaveClass(/is-ready/)
    await dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' }).click()
    await expect(motion).toHaveClass(/is-ready/)
    expect(await motion.evaluate((element: HTMLVideoElement) => ({ loop: element.loop, muted: element.muted, paused: element.paused }))).toEqual({ loop: true, muted: true, paused: false })
    const cover = await dialog.locator('.immersive-artwork').boundingBox(), frame = await motion.boundingBox()
    expect(frame).toEqual(cover)
    await page.mouse.move(200, 200)
    await dialog.getByRole('button', { name: 'Pausar en reproductor ampliado' }).click()
    await expect.poll(() => motion.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)

    // The next album has no video; coming back reuses the answer without asking again.
    await dialog.getByRole('button', { name: 'Siguiente en reproductor ampliado' }).click()
    await expect(dialog.getByRole('heading', { name: 'Portada animada dos' })).toBeVisible()
    await expect(motion).toHaveCount(0)
    await expect.poll(() => requests.length).toBe(2)
    await page.mouse.move(220, 220)
    await dialog.getByRole('button', { name: 'Anterior en reproductor ampliado' }).click()
    await expect(dialog.getByRole('heading', { name: 'Portada animada uno' })).toBeVisible()
    await expect(motion).toHaveCount(1)
    expect(requests).toHaveLength(2)
  })

  test('stays static with the switch off or with reduced motion', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop only')
    const requests = await simulate(page)
    await page.addInitScript(() => localStorage.setItem('openfy-motion-art', 'off'))
    let dialog = await open(page)
    await expect(dialog).toHaveClass(/big-picture/)
    await page.waitForTimeout(1200)
    expect(requests).toHaveLength(0)
    await expect(dialog.locator('.motion-art')).toHaveCount(0)

    await page.addInitScript(() => localStorage.setItem('openfy-motion-art', 'on'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    dialog = await open(page)
    await expect(dialog).toHaveClass(/big-picture/)
    await page.waitForTimeout(1200)
    expect(requests).toHaveLength(0)
    await expect(dialog.locator('.motion-art')).toHaveCount(0)
  })

  test('offers the switch in settings on desktop only', async ({ page }, info) => {
    await page.goto('/settings')
    const toggle = page.getByRole('switch', { name: 'Activar portadas animadas' }).or(page.getByRole('checkbox', { name: 'Activar portadas animadas' }))
    if (isPhone(info)) { await expect(page.getByRole('heading', { name: 'Movimiento ambiental' })).toBeVisible(); await expect(toggle).toHaveCount(0); return }
    await expect(toggle).toBeChecked()
    await page.getByText('Portadas animadas', { exact: true }).locator('xpath=ancestor::div[contains(@class,"setting-row")]').locator('.switch').click()
    await expect(toggle).not.toBeChecked()
    expect(await page.evaluate(() => localStorage.getItem('openfy-motion-art'))).toBe('off')
  })
})
