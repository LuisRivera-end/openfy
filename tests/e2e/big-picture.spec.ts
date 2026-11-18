import { test, expect, type Page } from '@playwright/test'
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
      await expect.poll(() => card.evaluate(el => el.getAnimations().length)).toBe(0)
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
      await page.mouse.move(100, 100)
      await expect(dialog).toHaveAttribute('data-controls', 'full')
      await page.waitForTimeout(100)
      const intermediate = (await dialog.locator('.immersive-artwork').boundingBox())!.width
      expect(intermediate).toBeGreaterThan(artBefore.width)
      expect(intermediate).toBeLessThan(artBefore.width * 1.2)
      await page.screenshot({ path: `output/big-picture-design/web-mid-${viewport.width}.png` })
      await expect.poll(() => dialog.locator('.immersive-artwork').evaluate(el => el.getAnimations().length)).toBe(0)
      await assertGeometry()
    })
  }

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
    await dialog.getByRole('button', { name: 'Siguiente en reproductor ampliado' }).click()
    await expect(dialog.locator('.immersive-info h1')).toHaveText(tracks[1]!.title)
    await page.waitForTimeout(700)
    await expect(content).toHaveAttribute('data-layout', 'cover')
    await expect(content).toHaveAttribute('data-layout', 'split')
    // The song travels over BIG_PICTURE.layoutMs; the dock does not move and the lyrics column appears once the song has arrived.
    expect(await art.evaluate(el => el.getAnimations().map(animation => animation.effect?.getTiming().duration))).toEqual([600])
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
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
        return type === 'webgl2' ? null : (getContext as (...args: unknown[]) => unknown).call(this, type, ...args)
      } as typeof getContext
    })
    const dialog = await open(page)
    await dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' }).fill('28')
    await expect(dialog.locator('.ambient-preview')).toBeVisible()
    await expect(dialog.getByRole('complementary', { name: 'Siguiente canción' })).toContainText(tracks[1]!.title)
    await dialog.getByRole('button', { name: 'Reproducir en reproductor ampliado' }).click()
    await dialog.getByRole('slider', { name: 'Posición en reproductor ampliado' }).fill('34')
    await expect(dialog.locator('.immersive-info h1')).toHaveText(tracks[1]!.title)
    await expect(dialog.locator('.next-flying-artwork')).toHaveCount(0)
  })
})
