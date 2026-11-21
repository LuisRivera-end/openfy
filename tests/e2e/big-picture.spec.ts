import { test, expect, devices, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import sharp from 'sharp'
import { generateAudio } from '../helpers/audio'
import { importButton, isPhone } from '../helpers/ui'
import type { Library, Track } from '../../shared/types/music'
import type { LyricsResult } from '../../shared/types/lyrics'

let directory: string, tracks: Track[]
test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-big-picture-'))
  tracks = []
  for (const [i, name] of ['Big Picture primera', 'Big Picture siguiente'].entries()) {
    const artwork = join(directory, `cover-${i}.jpg`)
    await sharp({ create: { width: 600, height: 600, channels: 3, background: i ? '#944e69' : '#3b7481' } }).jpeg().toFile(artwork)
    const filename = `${name}.m4a`, path = join(directory, filename)
    const lyrics = Array.from({ length: 35 }, (_, line) => `[00:${String(line).padStart(2, '0')}.00]Verso ${line + 1}`).join('\n')
    generateAudio(path, { duration: 35, format: 'aac', artwork, frequency: 300 + i * 80, lyrics })
    const response = await request.post(`/api/imports?filename=${encodeURIComponent(filename)}`, { data: await readFile(path), headers: { 'Content-Type': 'application/octet-stream' } })
    expect(response.status()).toBe(202)
    await expect.poll(async () => ((await (await request.get('/api/library')).json()) as Library).tracks.some(t => t.title === name)).toBe(true)
    tracks.push(((await (await request.get('/api/library')).json()) as Library).tracks.find(t => t.title === name)!)
  }
})
test.afterAll(async () => {
  expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true)
  await rm(directory, { recursive: true, force: true })
})

async function open(page: Page) {
  await page.goto('/library')
  await expect(importButton(page)).toBeEnabled()
  await page.evaluate(async tracks => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('openfy'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const queue = tracks.map((track, i) => ({ source: 'local', trackId: track.id, queueId: `big-picture-${i}` }))
    const tx = db.transaction('snapshots', 'readwrite')
    tx.objectStore('snapshots').put({ key: 'playback', value: { version: 3, queue, originalOrder: queue.map(e => e.queueId), index: 0, position: 0, volume: 0, repeat: 'off', shuffle: false } })
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close()
  }, tracks)
  await page.reload()
  await page.getByRole('button', { name: 'Abrir reproductor ampliado', exact: true }).click()
  return page.getByRole('dialog', { name: 'Reproductor ampliado' })
}

/** Serves each track's real lyrics, downgraded to another status (or a failure) per track, optionally late. */
async function lyricsAs(page: Page, statusFor: (index: number) => LyricsResult['status'] | 'error', delayFor: (index: number) => number = () => 0) {
  await page.route('**/api/lyrics/resolve', async route => {
    const index = tracks.findIndex(track => track.id === route.request().postDataJSON().entry.trackId)
    const status = statusFor(index), delay = delayFor(index)
    if (delay) await new Promise(done => setTimeout(done, delay))
    if (status === 'error') return route.fulfill({ status: 500, json: { message: 'Fallo de prueba' } })
    const response = await route.fetch(), json = await response.json() as LyricsResult
    return route.fulfill({ response, json: status === 'synced' ? json : { ...json, status, lines: [], plainText: status === 'plain' ? json.plainText || 'Verso sin tiempos' : '' } })
  })
}
const settled = (page: Page) => expect.poll(() => page.locator('.immersive-artwork').evaluate(el => el.getAnimations().length)).toBe(0)

async function installPhonePwa(page: Page, fullscreen = false) {
  await page.addInitScript(enableFullscreen => {
    const match = window.matchMedia.bind(window)
    window.matchMedia = query => {
      const result = match(query)
      if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true })
      return result
    }
    if (!enableFullscreen) Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true })
    if (screen.orientation) Object.defineProperty(screen.orientation, 'lock', {
      value: (orientation: string) => {
        document.documentElement.dataset.orientationRequested = orientation
        return Promise.reject(new DOMException('Locked'))
      },
    })
  }, fullscreen)
}

test.describe('Big Picture in the installed phone PWA', () => {
  test.use({ serviceWorkers: 'block' })

  test('enters on landscape and honors an explicit exit until the next rotation', async ({ page }, info) => {
    test.skip(!isPhone(info), 'Installed phone PWA')
    await installPhonePwa(page)
    const dialog = await open(page)
    await expect(dialog).not.toHaveClass(/mobile-picture/)
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(dialog).toHaveClass(/mobile-picture/)
    await expect(dialog.locator('.immersive-content')).toHaveAttribute('data-layout', 'split')
    await expect(dialog.getByRole('region', { name: 'Letras' }).getByText('Verso 1', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Salir de Big Picture' }).tap()
    await expect(dialog).not.toHaveClass(/mobile-picture/)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => matchMedia('(orientation: portrait)').matches)).toBe(true)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(dialog).toHaveClass(/mobile-picture/)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(dialog).not.toHaveClass(/mobile-picture/)
  })

  test('rotates the player and its sheets, maps scrubbing and keeps the card clear of the dock', async ({ page }, info) => {
    test.skip(!isPhone(info), 'Installed phone PWA')
    await installPhonePwa(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const dialog = await open(page)
    await dialog.getByRole('button', { name: 'Abrir Big Picture' }).tap()
    await expect(dialog).toHaveClass(/picture-turned/)
    await info.attach('Big Picture girado', { body: await page.screenshot(), contentType: 'image/png' })
    const seek = dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' })
    await expect(seek).toBeVisible()
    const rail = (await seek.boundingBox())!
    expect(rail.height).toBeGreaterThan(rail.width * 5)
    await page.touchscreen.tap(rail.x + rail.width / 2, rail.y + rail.height * .8)
    await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(25)
    await expect(dialog.getByRole('complementary', { name: 'Siguiente canción' })).toBeVisible()
    const verses = dialog.getByLabel('Versos de la canción')
    await expect(verses).toBeVisible()
    const before = await verses.evaluate(el => el.scrollTop)
    await verses.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 110 })
    await verses.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 160 })
    await verses.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1 })
    expect(await verses.evaluate(el => el.scrollTop)).toBeGreaterThan(before)
    await dialog.getByRole('button', { name: 'Abrir cola desde reproductor ampliado' }).tap()
    const sheet = page.getByRole('dialog', { name: 'Cola de reproducción' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveCSS('transform', /matrix\(0, 1, -1, 0,/)
    await sheet.getByRole('button', { name: 'Cerrar diálogo' }).tap()
    await expect(dialog).toHaveAttribute('data-controls', 'compact')
    await dialog.locator('.immersive-artwork').tap()
    await expect(dialog).toHaveAttribute('data-controls', 'full')
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(dialog).not.toHaveClass(/picture-turned/)
    await expect(dialog).toHaveClass(/mobile-picture/)
    await expect.poll(async () => {
      const card = await dialog.getByRole('complementary', { name: 'Siguiente canción' }).boundingBox()
      const slider = await seek.boundingBox()
      return !!card && !!slider && card.x >= 0 && card.y >= 44 && card.x + card.width <= 844
        && card.y + card.height <= slider.y
    }).toBe(true)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await info.attach('Big Picture horizontal', { body: await page.screenshot(), contentType: 'image/png' })
  })

  // The docked cover's 100dvh is the portrait height, not the turned stage's: it pushed the cover off screen for songs
  // without synced lyrics. Turned and landscape must lay out the same.
  for (const turned of [true, false]) {
    test(`keeps the docked cover, title and controls on screen ${turned ? 'turned in portrait' : 'in landscape'}`, async ({ page }, info) => {
      test.skip(!isPhone(info), 'Installed phone PWA')
      await installPhonePwa(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await lyricsAs(page, () => 'not_found')
      const dialog = await open(page)
      if (turned) {
        await dialog.getByRole('button', { name: 'Abrir Big Picture' }).tap()
        await expect(dialog).toHaveClass(/picture-turned/)
      } else {
        await page.setViewportSize({ width: 844, height: 390 })
        await expect(dialog).toHaveClass(/mobile-picture/)
      }
      await expect(dialog.locator('.immersive-content')).toHaveClass(/is-docked/)
      await info.attach('Portada acoplada', { body: await page.screenshot(), contentType: 'image/png' })
      const viewport = page.viewportSize()!
      const inside = async (selector: string) => {
        const box = (await dialog.locator(selector).first().boundingBox())!
        return box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + .5 && box.y + box.height <= viewport.height + .5
      }
      for (const selector of ['.immersive-artwork', '.immersive-info h1', '.immersive-seek', '.immersive-transport']) {
        await expect.poll(() => inside(selector), { message: selector }).toBe(true)
      }
      const fit = await dialog.evaluate(element => {
        const stage = element.querySelector<HTMLElement>('.picture-stage')!, content = element.querySelector<HTMLElement>('.immersive-content')!
        return { stage: stage.clientHeight, content: content.offsetHeight }
      })
      expect(fit.content).toBe(fit.stage)
      // A legible cover with the title aligned under it; the auto row once shrank it to 56 px in landscape.
      const art = await dialog.locator('.immersive-artwork').evaluate(element => element.getBoundingClientRect().toJSON())
      const title = await dialog.locator('.immersive-info').evaluate(element => element.getBoundingClientRect().toJSON())
      expect(Math.min(art.width, art.height)).toBeGreaterThan(140)
      // Centred along the long side of the screen, also with an iPhone's unequal insets (status bar plus clearance).
      await page.addStyleTag({ content: ':root { --safe-top: 59px; --safe-bottom: 34px; } .immersive { --status-clearance: 18px; }' })
      await expect.poll(async () => {
        const box = (await dialog.locator('.immersive-artwork').boundingBox())!
        return Math.round(turned ? box.y + box.height / 2 - viewport.height / 2 : box.x + box.width / 2 - viewport.width / 2)
      }).toBe(0)
      const ends = await dialog.locator('.immersive-seek input').evaluate(element => element.getBoundingClientRect().toJSON())
      if (turned) expect(viewport.height - ends.bottom).toBeLessThan(40)
      else expect(viewport.width - ends.right).toBeLessThan(40)
      if (turned) expect(Math.abs(art.top - title.top)).toBeLessThan(1)
      else expect(Math.abs(art.left - title.left)).toBeLessThan(1)
    })
  }

  test('holds the screen during active playback and releases late or hidden requests', async ({ page }, info) => {
    test.skip(!isPhone(info), 'Installed phone PWA')
    await installPhonePwa(page)
    await page.addInitScript(() => {
      const calls = { requested: 0, released: 0, active: 0, hold: true, resolve: () => {}, setHidden: (_hidden: boolean) => {} }
      Object.assign(window, { screenLockTest: calls })
      calls.setHidden = hidden => {
        Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      }
      Object.defineProperty(navigator, 'wakeLock', { value: {
        async request() {
          calls.requested++
          if (calls.hold) await new Promise<void>(resolve => { calls.resolve = resolve })
          calls.active++
          return Object.assign(new EventTarget(), {
            released: false,
            async release() {
              calls.released++
              calls.active--
            },
          })
        },
      } })
    })
    const dialog = await open(page)
    await dialog.getByRole('button', { name: 'Abrir Big Picture' }).tap()
    const wake = () => page.evaluate(() => {
      const { requested, released, active } = (window as unknown as {
        screenLockTest: { requested: number; released: number; active: number }
      }).screenLockTest
      return { requested, released, active }
    })
    const play = dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' })
    const pause = dialog.getByRole('button', { name: 'Pausar en reproductor ampliado' })
    await expect.poll(wake).toEqual({ requested: 0, released: 0, active: 0 })
    await play.tap()
    await expect.poll(wake).toEqual({ requested: 1, released: 0, active: 0 })
    await pause.tap()
    await page.evaluate(() => {
      const calls = (window as unknown as { screenLockTest: { hold: boolean; resolve: () => void } }).screenLockTest
      calls.hold = false
      calls.resolve()
    })
    await expect.poll(wake).toEqual({ requested: 1, released: 1, active: 0 })
    await play.tap()
    // Audio can briefly rebuffer. Check the live lock independent of intermediate requests.
    await expect.poll(async () => (await wake()).active).toBe(1)
    const visibility = (hidden: boolean) => page.evaluate(value => {
      (window as unknown as { screenLockTest: { setHidden(hidden: boolean): void } }).screenLockTest.setHidden(value)
    }, hidden)
    await visibility(true)
    await expect.poll(async () => (await wake()).active).toBe(0)
    const hiddenRequests = (await wake()).requested
    await visibility(false)
    await expect.poll(async () => (await wake()).active).toBe(1)
    expect((await wake()).requested).toBeGreaterThan(hiddenRequests)
    await dialog.getByRole('button', { name: 'Salir de Big Picture' }).tap()
    await expect.poll(async () => (await wake()).active).toBe(0)
    await expect(pause).toBeVisible()
  })

  test('requests document fullscreen and landscape from a Chromium phone tap', async ({ browser, baseURL, storageState }, info) => {
    test.skip(isPhone(info), 'Uses a Chromium touch context')
    const context = await browser.newContext({ ...devices['Pixel 7'], baseURL, storageState, serviceWorkers: 'block' })
    try {
      const page = await context.newPage()
      await installPhonePwa(page, true)
      await lyricsAs(page, () => 'plain')
      const dialog = await open(page)
      await dialog.getByRole('button', { name: 'Abrir Big Picture' }).tap()
      await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true)
      await expect(page.locator('html')).toHaveAttribute('data-orientation-requested', 'landscape')
      await expect(dialog.locator('.immersive-content')).toHaveAttribute('data-layout', 'cover')
      await expect(dialog.getByRole('region', { name: 'Letras' })).toHaveCount(0)
      await dialog.getByRole('button', { name: 'Salir de Big Picture' }).tap()
      await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null)
    } finally {
      await context.close()
    }
  })
})

async function disableWebGl(page: Page) {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
      return type === 'webgl2' ? null : (getContext as (...args: unknown[]) => unknown).call(this, type, ...args)
    } as typeof getContext
  })
}

test.describe('Big Picture', () => {
  test.use({ serviceWorkers: 'block' })
  test('keeps only the mini timeline after inactivity and restores on movement', async ({ page }, info) => {
    const dialog = await open(page)
    if (!isPhone(info)) await expect(dialog.locator('.immersive-artwork')).toHaveCSS('position', 'fixed')
    const art = await dialog.locator('.immersive-artwork').boundingBox()
    const header = await dialog.locator('.immersive-content > header').boundingBox()
    await page.waitForTimeout(4500)
    if (isPhone(info)) {
      await expect(dialog).not.toHaveClass(/big-picture/)
      await expect(dialog).toHaveAttribute('data-controls', 'full')
      await expect(dialog.locator('.immersive-mini')).toHaveCount(0)
      return
    }
    await expect(dialog).toHaveAttribute('data-controls', 'compact')
    await expect(dialog.getByRole('progressbar', { name: 'Progreso de la canción' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' })).toHaveCount(0)
    const enlarged = (await dialog.locator('.immersive-artwork').boundingBox())!
    expect(enlarged.width / art!.width).toBeCloseTo(1.2, 2)
    expect(await dialog.locator('.immersive-content > header').boundingBox()).toEqual(header)
    await page.screenshot({ path: 'output/big-picture-check/web-compact.png' })
    await page.mouse.move(100, 100)
    await expect(dialog).toHaveAttribute('data-controls', 'full')
    await expect(dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' })).toBeVisible()
    await expect.poll(async () => (await dialog.locator('.immersive-artwork').boundingBox())!.width).toBeCloseTo(art!.width, 0)
  })

  for (const viewport of [{ width: 1280, height: 800 }, { width: 1538, height: 750 }, { width: 1920, height: 1080 }]) {
    test(`positions the scene and moves the next card to the compact corner at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
      test.skip(isPhone(info), 'Desktop presentation only')
      await page.setViewportSize(viewport)
      const dialog = await open(page)
      await expect(dialog.locator('.immersive-artwork')).toHaveCSS('position', 'fixed')
      const seek = dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' })
      await seek.fill('28')
      const card = dialog.getByRole('complementary', { name: 'Siguiente canción' })
      await expect(card).toBeVisible()
      await expect.poll(() => card.evaluate(el => Math.abs(el.getBoundingClientRect().right - document.querySelector('.immersive-content')!.getBoundingClientRect().right))).toBeLessThan(1)
      const cardBefore = await card.boundingBox(), artBefore = (await dialog.locator('.immersive-artwork').boundingBox())!
      let fullGap: number | undefined
      const settledCard = async (compact: boolean) => {
        // Docked above the controls with them visible; in compact mode the larger card sits 32 px from the bottom-right corner.
        if (compact) await expect.poll(async () => { const box = (await card.boundingBox())!; return [Math.round(viewport.width - box.x - box.width), Math.round(viewport.height - box.y - box.height), Math.round(box.height)] }).toEqual([32, 32, 160])
        else await expect.poll(async () => { const box = (await card.boundingBox())!; return [box.x, box.y, box.width, box.height].map(Math.round) }).toEqual([cardBefore!.x, cardBefore!.y, cardBefore!.width, cardBefore!.height].map(Math.round))
        return (await card.boundingBox())!
      }
      const assertGeometry = async (compact = false) => {
        const cardBox = await settledCard(compact)
        if (compact) expect(cardBox.width).toBeGreaterThan(cardBefore!.width)
        const art = (await dialog.locator('.immersive-artwork').boundingBox())!, lyrics = (await dialog.locator('.immersive-lyrics').boundingBox())!
        expect(Math.abs(lyrics.y - art.y - art.height * .2)).toBeLessThan(1)
        expect(lyrics.y + lyrics.height).toBeLessThanOrEqual(cardBox.y - 15)
        const gap = lyrics.x - (art.x + art.width)
        expect(gap).toBeGreaterThanOrEqual(31)
        // The enlarged artwork keeps the full-size gap; the lyrics move into the outer margin.
        if (fullGap === undefined) fullGap = gap
        else expect(Math.abs(gap - fullGap)).toBeLessThan(1)
        expect(lyrics.x + lyrics.width).toBeLessThanOrEqual(viewport.width - 48 + 1)
      }
      await assertGeometry()
      await expect(dialog.locator('.lyrics-scroll-shell')).toHaveClass(/has-depth/)
      // Both edges share the same fade, with no blurred layer on top.
      expect(await dialog.locator('.has-depth > .lyrics-scroll').evaluate(el => { const style = getComputedStyle(el); return style.maskImage || style.getPropertyValue('-webkit-mask-image') })).toMatch(/18%[\s\S]*82%|18%[\s\S]*100% - 18%/)
      await expect(dialog.locator('.lyrics-depth-edge')).toHaveCount(0)
      await page.screenshot({ path: `output/big-picture-design/web-full-${viewport.width}.png` })
      await expect(dialog).toHaveAttribute('data-controls', 'compact', { timeout: 6000 })
      await expect.poll(() => dialog.locator('.immersive-artwork').evaluate(el => el.getAnimations().length)).toBe(0)
      await assertGeometry(true)
      expect((await dialog.locator('.immersive-artwork').boundingBox())!.width / artBefore.width).toBeCloseTo(1.2, 2)
      await page.screenshot({ path: `output/big-picture-design/web-compact-${viewport.width}.png` })
      await page.screenshot({ path: `output/big-picture-check/web-next-card-compact-${viewport.width}.png` })
      const art = dialog.locator('.immersive-artwork')
      await art.evaluate(element => {
        const dialog = element.closest('dialog')!
        const observer = new MutationObserver(() => {
          if (dialog.dataset.controls !== 'full') return
          const animation = element.getAnimations().find(animation => animation.effect?.getTiming().duration === 320)
          if (animation) { animation.pause(); animation.currentTime = 100 }
          observer.disconnect()
        })
        observer.observe(dialog, { attributes: true, attributeFilter: ['data-controls'] })
      })
      await page.mouse.move(100, 100)
      await expect(dialog).toHaveAttribute('data-controls', 'full')
      const intermediate = (await art.boundingBox())!.width
      expect(intermediate).toBeGreaterThan(artBefore.width)
      expect(intermediate).toBeLessThan(artBefore.width * 1.2)
      await page.screenshot({ path: `output/big-picture-design/web-mid-${viewport.width}.png` })
      await art.evaluate(el => el.getAnimations().forEach(animation => animation.play()))
      await settled(page)
      await assertGeometry()
    })
  }

  for (const renderer of ['WebGL', 'CSS fallback']) test(`slides in from the right with ${renderer} in both control modes`, async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    if (renderer === 'CSS fallback') await disableWebGl(page)
    else await page.addInitScript(() => {
      const gl = WebGL2RenderingContext.prototype
      const locate = gl.getUniformLocation, upload = gl.uniform4f
      const previewRect = new WeakSet<WebGLUniformLocation>()
      gl.getUniformLocation = function(program, name) {
        const location = locate.call(this, program, name)
        if (name === 'previewRect' && location) previewRect.add(location)
        return location
      }
      gl.uniform4f = function(location, x, y, width, height) {
        if (location && previewRect.has(location) && this.canvas instanceof HTMLCanvasElement) this.canvas.dataset.previewLeft = String(x)
        upload.call(this, location, x, y, width, height)
      }
    })
    const dialog = await open(page)
    const card = dialog.getByRole('complementary', { name: 'Siguiente canción' })
    const seek = dialog.locator('.immersive-seek input[type="range"]')
    if (renderer === 'WebGL') {
      const ambient = dialog.locator('.ambient').first()
      await expect(ambient).toHaveAttribute('data-ambient', /^(webgl|css)$/)
      test.skip(await ambient.getAttribute('data-ambient') === 'css', 'WebGL2 is unavailable')
    }
    await expect(dialog.locator('.immersive-content')).toHaveAttribute('data-layout', 'split')
    for (const mode of ['full', 'compact']) {
      await expect(dialog).toHaveAttribute('data-controls', mode, { timeout: 6500 })
      const frames = await seek.evaluate(input => new Promise<Array<{ x: number, y: number, right: number, clipLeft: number }>>(resolve => {
        const slider = input as HTMLInputElement, dialog = slider.closest('dialog')!
        const frames: Array<{ x: number, y: number, right: number, clipLeft: number }> = []
        const observer = new MutationObserver(() => {
          const card = dialog.querySelector('.next-card'), preview = dialog.querySelector<HTMLElement>('.ambient-preview, .ambient-canvas')
          if (!card || !preview) return
          const { x, y, right } = card.getBoundingClientRect()
          const clipLeft = Number.parseFloat(preview.dataset.previewLeft ?? preview.style.clipPath.split(' ')[3] ?? '')
          if (frames.at(-1)?.x !== x) frames.push({ x, y, right, clipLeft })
        })
        observer.observe(dialog, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
        slider.value = '28'; slider.dispatchEvent(new Event('input', { bubbles: true }))
        setTimeout(() => { observer.disconnect(); resolve(frames) }, 500)
      }))
      const width = await page.evaluate(() => innerWidth)
      const first = frames[0]!, last = frames.at(-1)!
      expect(first.x).toBeCloseTo(width, 1)
      expect(frames.some(frame => frame.x < width - 1 && frame.x > last.x + 1)).toBe(true)
      for (const frame of frames) {
        expect(frame.y).toBeCloseTo(last.y, 1)
        if (frame.x < width - 1) expect(frame.clipLeft).toBeCloseTo(frame.x, 1)
      }
      const contentRight = await dialog.locator('.immersive-content').evaluate(el => el.getBoundingClientRect().right)
      const targetRight = mode === 'compact' ? width - 32 : contentRight
      expect(last.right).toBeCloseTo(targetRight, 1)
      await seek.evaluate((slider: HTMLInputElement) => { slider.value = '10'; slider.dispatchEvent(new Event('input', { bubbles: true })) })
      await expect(card).toHaveCount(0)
    }
  })

  test('previews the next cover, follows seeks and suppresses repeat-one', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    const dialog = await open(page), seek = dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' })
    await seek.fill('28')
    const card = dialog.getByRole('complementary', { name: 'Siguiente canción' })
    await expect(card).toContainText(tracks[1]!.title)
    await expect(card).toContainText('En pausa')
    await expect(card.locator('img')).toBeVisible()
    const cardBox = (await card.boundingBox())!, dock = (await dialog.locator('.immersive-seek').boundingBox())!, lyrics = (await dialog.locator('.immersive-lyrics').boundingBox())!
    expect(cardBox.y + cardBox.height).toBeLessThan(dock.y)
    expect(lyrics.y + lyrics.height).toBeLessThanOrEqual(cardBox.y - 15)
    await page.screenshot({ path: 'output/big-picture-check/web-next-card.png' })
    await seek.fill('10'); await expect(card).toHaveCount(0)
    await seek.fill('28'); await expect(card).toBeVisible()
    const repeat = dialog.getByRole('button', { name: 'Repetir en reproductor ampliado' })
    await repeat.click(); await repeat.click()
    await expect(card).toHaveCount(0)
  })

  test('expands the announced cover on actual playback and preserves the compact state', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    const dialog = await open(page)
    await dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' }).click()
    const audio = page.getByTestId('audio-engine')
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState >= 3 && !element.paused && element.currentTime > 0)).toBe(true)
    await dialog.evaluate(element => {
      const observer = new MutationObserver(() => {
        if (element.classList.contains('is-morphing')) { element.setAttribute('data-promotion-seen', 'true'); observer.disconnect() }
      })
      observer.observe(element, { attributes: true, attributeFilter: ['class'] })
    })
    await page.mouse.move(101, 100)
    await dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' }).fill('25')
    await page.mouse.move(100, 100)
    await expect(dialog).toHaveAttribute('data-controls', 'compact', { timeout: 7000 })
    await expect(dialog).toHaveAttribute('data-promotion-seen', 'true', { timeout: 20000 })
    await page.screenshot({ path: 'output/big-picture-check/web-transition.png' })
    await expect(dialog).not.toHaveClass(/is-morphing/)
    await expect(dialog.locator('.immersive-info h1')).toHaveText(tracks[1]!.title)
    await expect(dialog).toHaveAttribute('data-controls', 'compact')
    await expect(page.getByTestId('audio-engine')).toHaveJSProperty('paused', false)
  })

  test('starts the expansion at the card position during entry', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    await page.clock.install()
    const dialog = await open(page)
    await dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' }).click()
    const audio = page.getByTestId('audio-engine')
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState >= 3 && !element.paused)).toBe(true)
    const pausedAt = (await page.evaluate(() => Date.now())) + 500
    await page.clock.pauseAt(pausedAt)
    await dialog.locator('.immersive-seek input').evaluate((slider: HTMLInputElement) => {
      slider.value = '28'; slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.clock.runFor(64)
    const card = dialog.getByRole('complementary', { name: 'Siguiente canción' })
    const box = (await card.boundingBox())!
    const width = await page.evaluate(() => innerWidth)
    expect(box.x).toBeLessThan(width)
    expect(box.x + box.width).toBeGreaterThan(width)
    await dialog.getByRole('button', { name: 'Siguiente en reproductor ampliado' }).evaluate((button: HTMLButtonElement) => button.click())
    await expect(dialog).toHaveClass(/is-morphing/)
    const flying = (await dialog.locator('.next-flying-artwork').boundingBox())!
    expect(flying.x).toBeCloseTo(box.x + 16, 1)
    expect(flying.y).toBeCloseTo(box.y + 20, 1)
    await page.clock.runFor(1300)
    await expect(dialog.locator('.immersive-info h1')).toHaveText(tracks[1]!.title)
  })

  test('retains controls for keyboard focus and a held pointer', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    const dialog = await open(page), seek = dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' })
    await seek.press('ArrowRight')
    await page.waitForTimeout(4400)
    await expect(dialog).toHaveAttribute('data-controls', 'full')
    await page.mouse.move(120, 120); await page.mouse.down()
    await page.waitForTimeout(4400)
    await expect(dialog).toHaveAttribute('data-controls', 'full')
    await page.mouse.up()
    await expect(dialog).toHaveAttribute('data-controls', 'compact', { timeout: 5500 })
  })

  test('enters idle after leaving the player or switching windows with keyboard focus', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    const dialog = await open(page), seek = dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' })
    await seek.press('ArrowRight')
    await dialog.dispatchEvent('pointerleave', { pointerType: 'mouse', buttons: 0 })
    await expect(dialog).toHaveAttribute('data-controls', 'compact', { timeout: 5500 })
    await page.mouse.move(120, 120)
    await seek.press('ArrowRight')
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(dialog).toHaveAttribute('data-controls', 'compact', { timeout: 5500 })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(dialog).toHaveAttribute('data-controls', 'compact')
    await page.mouse.move(130, 120)
    await expect(dialog).toHaveAttribute('data-controls', 'full')
  })

  test('aligns new lyrics before revealing the next song', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    const dialog = await open(page)
    await dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' }).fill('32')
    await expect.poll(() => dialog.locator('.lyrics-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(500)
    await dialog.evaluate((element, title) => {
      const observer = new MutationObserver(() => {
        if (element.querySelector('h1')?.textContent !== title || element.classList.contains('is-morphing') || element.classList.contains('is-switching')) return
        requestAnimationFrame(() => {
          const scroll = element.querySelector<HTMLElement>('.lyrics-scroll'), line = scroll?.querySelector<HTMLElement>('[aria-current="true"]')
          if (!scroll || !line || element.hasAttribute('data-first-lyrics-error')) return
          const rect = line.getBoundingClientRect(), outer = scroll.getBoundingClientRect()
          const target = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, scroll.scrollTop + rect.top - outer.top - scroll.clientHeight * .35 + rect.height / 2))
          element.setAttribute('data-first-lyrics-error', String(Math.abs(scroll.scrollTop - target)))
          observer.disconnect()
        })
      })
      observer.observe(element, { subtree: true, childList: true, attributes: true })
    }, tracks[1]!.title)
    await dialog.getByRole('button', { name: 'Siguiente en reproductor ampliado' }).click()
    await expect(dialog.locator('.immersive-info h1')).toHaveText(tracks[1]!.title, { timeout: 20000 })
    await expect.poll(async () => Number(await dialog.getAttribute('data-first-lyrics-error') ?? 'Infinity')).toBeLessThan(2)
  })

  test('cancels a promotion when another occurrence is selected', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    const dialog = await open(page)
    await dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' }).click()
    await expect.poll(() => page.getByTestId('audio-engine').evaluate((element: HTMLAudioElement) => element.readyState >= 3 && !element.paused && element.currentTime > 0)).toBe(true)
    await dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' }).fill('34')
    await expect(dialog).toHaveClass(/is-morphing/)
    await page.mouse.move(100, 100)
    await dialog.getByRole('button', { name: 'Anterior en reproductor ampliado' }).click()
    await expect(dialog).not.toHaveClass(/is-morphing/)
    await expect(dialog.locator('.immersive-info h1')).toHaveText(tracks[0]!.title)
    await expect(dialog.locator('.next-flying-artwork')).toHaveCount(0)
  })

  for (const status of ['plain', 'instrumental', 'not_found', 'error'] as const) {
    test(`keeps only the song and the dock without synced lyrics (${status})`, async ({ page }, info) => {
      test.skip(isPhone(info), 'Desktop presentation only')
      const viewport = { width: 1538, height: 750 }
      await page.setViewportSize(viewport)
      await lyricsAs(page, () => status)
      const dialog = await open(page)
      const content = dialog.locator('.immersive-content')
      await expect(content).toHaveAttribute('data-layout', 'cover')
      await expect(content).toHaveClass(/is-docked/)
      await expect(dialog.getByRole('region', { name: 'Letras' })).toHaveCount(0)
      await expect(dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Pausar en reproductor ampliado' }).or(dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' }))).toBeVisible()
      await expect(dialog.locator('.immersive-info h1')).toHaveText(tracks[0]!.title)
      await settled(page)
      const art = (await dialog.locator('.immersive-artwork').boundingBox())!
      expect(Math.abs(art.x + art.width / 2 - viewport.width / 2)).toBeLessThan(2)
      // The idle state grows and recentres the song like the split layout.
      await page.waitForTimeout(4500)
      await expect(dialog).toHaveAttribute('data-controls', 'compact')
      await settled(page)
      const enlarged = (await dialog.locator('.immersive-artwork').boundingBox())!
      expect(enlarged.width / art.width).toBeGreaterThan(1.05)
      expect(Math.abs(enlarged.x + enlarged.width / 2 - viewport.width / 2)).toBeLessThan(2)
      if (status === 'plain') await page.screenshot({ path: 'output/big-picture-check/web-cover.png' })
    })
  }

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1538, height: 750 }, { width: 1280, height: 800 }]) {
    test(`keeps the compact corner card clear of the centred song at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
      test.skip(isPhone(info), 'Desktop presentation only')
      await page.setViewportSize(viewport)
      await lyricsAs(page, () => 'plain')
      const dialog = await open(page)
      await expect(dialog.locator('.immersive-content')).toHaveAttribute('data-layout', 'cover')
      await dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' }).fill('28')
      const card = dialog.getByRole('complementary', { name: 'Siguiente canción' })
      await expect(card).toBeVisible()
      await expect(dialog).toHaveAttribute('data-controls', 'compact', { timeout: 6000 })
      await settled(page)
      // The corner card keeps its 32 px margins and leaves 24 px (avoidGap) beside the artwork, title and mini progress.
      await expect.poll(async () => { const box = (await card.boundingBox())!; return [Math.round(viewport.width - box.x - box.width), Math.round(viewport.height - box.y - box.height)] }).toEqual([32, 32])
      const box = (await card.boundingBox())!
      for (const selector of ['.immersive-artwork', '.immersive-info', '.immersive-mini']) {
        const column = (await dialog.locator(selector).boundingBox())!
        const clear = box.x >= column.x + column.width + 23 || box.y >= column.y + column.height
        expect(clear, `${selector} ${JSON.stringify(column)} vs card ${JSON.stringify(box)}`).toBe(true)
      }
      expect(box.width).toBeGreaterThanOrEqual(314)
      await page.screenshot({ path: `output/big-picture-check/web-cover-next-card-${viewport.width}.png` })
    })
  }

  test('slides the song between its column and the centre while the dock stays put', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    const viewport = { width: 1538, height: 750 }
    await page.setViewportSize(viewport)
    // The second song's answer arrives late: while it loads, the centred layout of the first one stays.
    await lyricsAs(page, index => index === 0 ? 'plain' : 'synced', index => index === 1 ? 1500 : 0)
    const dialog = await open(page)
    const content = dialog.locator('.immersive-content'), art = dialog.locator('.immersive-artwork')
    await expect(content).toHaveAttribute('data-layout', 'cover')
    await settled(page)
    const seek = await dialog.locator('.immersive-seek').boundingBox(), transport = await dialog.locator('.immersive-transport').boundingBox()
    await content.evaluate(element => {
      const observer = new MutationObserver(() => {
        if (element.getAttribute('data-layout') !== 'split') return
        const animations = element.querySelector('.immersive-artwork')!.getAnimations()
        element.setAttribute('data-layout-animation', JSON.stringify(animations.map(animation => animation.effect?.getTiming().duration)))
        observer.disconnect()
      })
      observer.observe(element, { attributes: true, attributeFilter: ['data-layout'] })
    })
    await dialog.getByRole('button', { name: 'Siguiente en reproductor ampliado' }).press('Enter')
    await expect(dialog.locator('.immersive-info h1')).toHaveText(tracks[1]!.title)
    await page.waitForTimeout(700)
    await expect(content).toHaveAttribute('data-layout', 'cover')
    await expect(content).toHaveAttribute('data-layout', 'split')
    // The song travels over BIG_PICTURE.layoutMs; the dock does not move and the lyrics column appears once the song has arrived.
    await expect(content).toHaveAttribute('data-layout-animation', '[600]')
    expect(await dialog.locator('.immersive-seek').boundingBox()).toEqual(seek)
    expect(await dialog.locator('.immersive-transport').boundingBox()).toEqual(transport)
    await expect(dialog.getByRole('region', { name: 'Letras' })).toBeVisible()
    await settled(page)
    await expect.poll(() => dialog.locator('.immersive-lyrics').evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    const column = (await art.boundingBox())!
    expect(column.x + column.width).toBeLessThan(viewport.width / 2)
    await page.screenshot({ path: 'output/big-picture-check/web-cover-to-split.png' })
  })

  test('applies the layout change directly with reduced motion', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1538, height: 750 })
    await lyricsAs(page, index => index === 0 ? 'synced' : 'plain')
    const dialog = await open(page)
    const content = dialog.locator('.immersive-content')
    await expect(content).toHaveAttribute('data-layout', 'split')
    await dialog.getByRole('button', { name: 'Siguiente en reproductor ampliado' }).click()
    await expect(content).toHaveAttribute('data-layout', 'cover')
    expect(await dialog.locator('.immersive-artwork').evaluate(el => el.getAnimations().length)).toBe(0)
    await expect(dialog.getByRole('region', { name: 'Letras' })).toHaveCount(0)
  })

  test('hides the narrow lyrics button without synced lyrics', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    await page.setViewportSize({ width: 800, height: 980 })
    await lyricsAs(page, () => 'plain')
    const dialog = await open(page)
    await expect(dialog).toHaveClass(/big-picture/)
    await expect(dialog.locator('.immersive-content')).toHaveAttribute('data-layout', 'cover')
    await expect(dialog.getByRole('button', { name: 'Letra en reproductor ampliado', exact: true })).toHaveCount(0)
  })

  test('keeps a narrow desktop layout and browser fullscreen eligible', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    await page.setViewportSize({ width: 800, height: 980 })
    const dialog = await open(page)
    const lyricsToggle = dialog.getByRole('button', { name: 'Letra en reproductor ampliado', exact: true })
    await lyricsToggle.click()
    await expect(dialog.locator('.immersive-content')).toHaveAttribute('data-layout', 'cover')
    await lyricsToggle.click()
    await expect(dialog.locator('.immersive-content')).toHaveAttribute('data-layout', 'stacked')
    await expect(dialog.locator('.immersive-lyrics')).toHaveCSS('position', 'fixed')
    await dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' }).fill('28')
    await expect(dialog.getByRole('complementary', { name: 'Siguiente canción' })).toBeVisible()
    await expect(dialog).toHaveClass(/big-picture/)
    await dialog.getByRole('button', { name: 'Pantalla completa', exact: true }).click()
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
    await expect(dialog).toHaveClass(/big-picture/)
    await page.screenshot({ path: 'output/big-picture-check/web-narrow.png' })
  })

  test('excludes an installed PWA on a desktop viewport', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop PWA exclusion')
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window)
      window.matchMedia = query => {
        const result = original(query)
        if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true })
        return result
      }
    })
    const dialog = await open(page)
    await page.waitForTimeout(4400)
    await expect(dialog).not.toHaveClass(/big-picture/)
    await expect(dialog.locator('.immersive-mini')).toHaveCount(0)
    await expect(dialog).toHaveAttribute('data-controls', 'full')
  })

  test('uses the palette fallback with reduced motion and no WebGL', async ({ page }, info) => {
    test.skip(isPhone(info), 'Desktop presentation only')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await disableWebGl(page)
    const dialog = await open(page)
    await expect(dialog.locator('.immersive-content')).toHaveAttribute('data-layout', 'split')
    await page.mouse.move(100, 100)
    await dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' }).fill('28')
    await expect(dialog.locator('.ambient-preview')).toBeVisible()
    await expect(dialog.getByRole('complementary', { name: 'Siguiente canción' })).toContainText(tracks[1]!.title)
    const offset = await dialog.locator('.next-card').evaluate(el => {
      const player = el.closest('dialog')!
      const right = player.dataset.controls === 'compact' ? innerWidth - 32 : player.querySelector('.immersive-content')!.getBoundingClientRect().right
      return Math.abs(el.getBoundingClientRect().right - right)
    })
    expect(offset).toBeLessThan(1)
    await page.mouse.move(101, 100)
    await dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' }).click()
    await dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' }).fill('34')
    await expect(dialog.locator('.immersive-info h1')).toHaveText(tracks[1]!.title)
    await expect(dialog.locator('.next-flying-artwork')).toHaveCount(0)
  })
})
