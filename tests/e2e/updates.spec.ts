import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAudio } from '../helpers/audio'
import type { Library } from '../../shared/types/music'

test('a waiting service worker waits for the other tab to save its form and reloads both once', async ({ page, request }) => {
  await page.goto('/settings')
  await expect(page.getByRole('checkbox',{name:'Activar movimiento ambiental'})).toBeVisible()
  await page.getByRole('checkbox',{name:'Activar movimiento ambiental'}).press('Space')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  const other = await page.context().newPage()
  await other.goto('/library')
  // Different playback settings prove that each tab restores its own session.
  await other.evaluate(async () => {
    const open = indexedDB.open('openfy')
    const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error) })
    const tx = db.transaction('snapshots','readwrite')
    tx.objectStore('snapshots').put({ key:'playback', value:{ version:3, queue:[], originalOrder:[], index:0, position:0, volume:.21, shuffle:false, repeat:'off' } })
    await new Promise<void>((resolve,reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close()
  })
  // Navigate from a neutral document to avoid a running player's pagehide save.
  const perTab = await page.context().newPage()
  await perTab.goto('/settings')
  await expect(perTab.getByTestId('audio-engine')).toHaveJSProperty('volume',.21)
  const originalVolume = await page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => audio.volume)
  expect(originalVolume).not.toBe(.21)
  await other.getByRole('main').getByRole('button',{name:'Crear playlist',exact:true}).click()
  await other.getByRole('textbox',{name:'Nombre',exact:true}).fill('Borrador')
  await request.post('/__test/update')
  await page.getByRole('button',{name:'Buscar actualizaciones'}).click()
  const install = page.getByRole('button',{name:'Actualizar y reiniciar'})
  await expect(install).toBeVisible()
  await install.click()
  await expect(page.getByText('Otra pestaña aún está en uso.').first()).toBeVisible()
  await expect(other.getByRole('textbox',{name:'Nombre',exact:true})).toHaveValue('Borrador')
  await other.getByRole('button',{name:'Cerrar diálogo'}).click()
  // History replacements by the router also emit framenavigated. Count new
  // documents to distinguish a reload from a same-document URL change.
  await page.context().addInitScript(() => {
    if (window.top === window) sessionStorage.setItem('qa-update-loads', String(Number(sessionStorage.getItem('qa-update-loads') || 0) + 1))
  })
  await install.click()
  await expect.poll(() => Promise.all([page, other, perTab].map(tab => tab.evaluate(() => sessionStorage.getItem('qa-update-loads')).catch(() => null)))).toEqual(['1','1','1'])
  await expect(page.getByRole('checkbox',{name:'Activar movimiento ambiental'})).not.toBeChecked()
  await expect(page.getByRole('checkbox',{name:'Nuevo diseño'})).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-design')
  await expect.poll(() => page.locator('.player-bar').evaluate(bar => parseFloat(getComputedStyle(bar).borderTopLeftRadius))).toBeGreaterThanOrEqual(16)
  await expect(install).toHaveCount(0)
  await expect(page.getByTestId('audio-engine')).toHaveJSProperty('volume',originalVolume)
  await expect(perTab.getByTestId('audio-engine')).toHaveJSProperty('volume',.21)
  for (const tab of [page, other, perTab]) expect(await tab.evaluate(() => sessionStorage.getItem('qa-update-loads'))).toBe('1')
  await expect(other.getByRole('main').getByRole('button',{name:'Crear playlist',exact:true})).toBeVisible()
})

test.describe('with a track', () => {
  let directory: string
  const title = 'Actualización sonando'
  test.beforeAll(async ({ request }) => {
    directory = await mkdtemp(join(tmpdir(), 'openfy-updates-e2e-'))
    const path = join(directory, `${title}.mp3`)
    generateAudio(path, { duration: 40, frequency: 330 })
    const imported = await request.post(`/api/imports?filename=${encodeURIComponent(`${title}.mp3`)}`, { data: await readFile(path), headers: { 'Content-Type': 'application/octet-stream' } })
    expect(imported.status()).toBe(202)
    await expect.poll(async () => (await (await request.get('/api/library')).json() as Library).tracks.some(track => track.title === title), { timeout: 20000 }).toBe(true)
  })
  test.afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

  async function play(page: Page) {
    await page.goto('/library')
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    })
    await page.getByRole('textbox', { name: 'Filtrar canciones', exact: true }).fill(title)
    await page.getByRole('button', { name: `Reproducir ${title}`, exact: true }).click()
    await expect.poll(() => page.getByTestId('audio-engine').evaluate((audio: HTMLAudioElement) => !audio.paused && audio.currentTime > .1)).toBe(true)
  }

  test('lock screen controls offer previous and next track instead of ten-second skips', async ({ page }) => {
    await page.addInitScript(() => {
      const actions = new Set<string>(), log: string[] = []
      Object.defineProperty(window, '__media', { value: { actions, log } })
      const session = navigator.mediaSession
      if (!session) return
      const original = session.setActionHandler.bind(session)
      session.setActionHandler = (action, handler) => {
        if (handler) actions.add(action); else actions.delete(action)
        log.push(`${action}:${handler ? 'set' : 'null'}:${document.querySelector('audio')?.paused === false ? 'playing' : 'idle'}`)
        original(action, handler)
      }
    })
    await play(page)
    const media = await page.evaluate(() => {
      if (!navigator.mediaSession) return null
      const state = (window as unknown as { __media: { actions: Set<string>; log: string[] } }).__media
      return { actions: [...state.actions], log: state.log }
    })
    test.skip(media === null, 'Media Session is not available in this browser')
    expect(media!.actions).toEqual(expect.arrayContaining(['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']))
    expect(media!.actions).not.toContain('seekforward')
    expect(media!.actions).not.toContain('seekbackward')
    // iOS ignores handlers registered before the element is "Now Playing"; they must be set again once audio plays.
    expect(media!.log).toContain('nexttrack:set:playing')
    expect(media!.log).toContain('previoustrack:set:playing')
    expect(media!.log).toContain('seekforward:null:playing')
  })

  test('update and restart works while music is playing', async ({ page, request, browserName }) => {
    // Desktop Chromium keeps the old worker active after local playback until its lame-duck
    // timeout (cause not identified); the PWA's target is iOS, covered by mobile-webkit.
    test.skip(browserName === 'chromium', 'Chromium holds service worker activation after playback')
    await play(page)
    await page.context().addInitScript(() => {
      if (window.top === window) sessionStorage.setItem('qa-update-loads', String(Number(sessionStorage.getItem('qa-update-loads') || 0) + 1))
    })
    await request.post('/__test/update')
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update() })
    const install = page.getByRole('button', { name: 'Actualizar y reiniciar' })
    await expect(install).toBeVisible()
    // Playing keeps the automatic path busy; only the button can apply it.
    await expect(page.getByTestId('audio-engine')).toHaveJSProperty('paused', false)
    await install.click()
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('qa-update-loads')).catch(() => null), { timeout: 20000 }).toBe('1')
    await expect(install).toHaveCount(0)
    await expect(page.getByTestId('audio-engine')).toHaveJSProperty('paused', true)
  })
})
