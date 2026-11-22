import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

const song = { videoId: 'startup0001', title: 'Al despertar', artists: ['Openfy'], album: 'Mañana', duration: 120, artwork: 'https://startup.invalid/cover.png' }
const discovery = { songs: [song], releases: [], algorithmVersion: 2, generatedAt: 1000, stale: false, error: null }
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve }); return { promise, release } }
async function fixtures(page: Page) {
  await page.route('**/api/library', route => route.fulfill({ json: { tracks: [], youtubeSongs: [], playlists: [] } }))
  await page.route('**/api/imports', route => route.fulfill({ json: [] }))
  await page.route('**/api/telemetry/recent**', route => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/telemetry/stats**', route => route.fulfill({ json: { period: 'all', byTrack: {}, listenedMs: 0, plays: 0, lastPlayedAt: 0 } }))
  await page.route('**/api/music/recommendations**', route => route.fulfill({ json: discovery }))
  await page.route('**/api/activity', route => route.fulfill({ json: {} }))
  await page.route('**/api/music/downloads**', route => route.fulfill({ json: [] }))
  await page.route('**/api/offline/collections**', route => route.fulfill({ json: [] }))
}

test('holds the shell until essential data and the first Home request are ready', async ({ page }, info) => {
  await fixtures(page)
  const essential = gate(), content = gate()
  let requests = 0
  await page.route('**/api/library', async route => { requests++; await essential.promise; await route.fulfill({ json: { tracks: [], youtubeSongs: [], playlists: [] } }) })
  await page.route('**/api/music/recommendations**', async route => { await content.promise; await route.fulfill({ json: discovery }) })
  await page.goto('/')
  await expect(page.getByTestId('startup-screen')).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '')
  await page.screenshot({ path: `output/playwright/${info.project.name}-startup.png` })
  essential.release()
  await expect(page.locator('.home-placeholder')).toHaveCount(4)
  await expect(page.getByTestId('startup-screen')).toBeVisible()
  content.release()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible()
  await expect(page.getByRole('main')).toBeFocused()
  await expect(page.locator('audio')).toHaveCount(1)
  expect(requests).toBe(1)
  await page.getByRole('link', { name: 'Tu biblioteca', exact: true }).first().click()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0)
})

test('defers slow recommendations, preserves placeholders and accepts the late result once', async ({ page }) => {
  await fixtures(page)
  const pending = gate(), cover = gate()
  let requests = 0
  await page.route('**/api/music/recommendations**', async route => { requests++; await pending.promise; await route.fulfill({ json: discovery }) })
  await page.route('**/api/artwork**', async route => { await cover.promise; await route.abort() })
  await page.goto('/')
  await expect(page.getByTestId('startup-screen')).toBeVisible()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0, { timeout: 9000 })
  await expect(page.locator('.home-placeholder')).toHaveCount(4)
  pending.release()
  await expect(page.getByRole('button', { name: 'Reproducir Al despertar', exact: true })).toBeVisible()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0)
  expect(requests).toBe(1)
  cover.release()
})

test('uses cached Home data immediately while a refresh is still pending', async ({ page }) => {
  await fixtures(page)
  await page.goto('/')
  await expect(page.getByTestId('startup-screen')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reproducir Al despertar', exact: true })).toBeVisible()
  const pending = gate()
  await page.route('**/api/music/recommendations**', async route => { await pending.promise; await route.fulfill({ json: discovery }) })
  await page.reload()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0, { timeout: 3500 })
  await expect(page.getByRole('button', { name: 'Reproducir Al despertar', exact: true })).toBeVisible()
  pending.release()
})

test('retries a failed essential stage without recreating successful stages or audio', async ({ page }) => {
  await fixtures(page)
  let libraryRequests = 0
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/library') libraryRequests++ })
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    let failed = false
    IDBObjectStore.prototype.put = function (value, key) {
      if (!failed && this.name === 'snapshots' && value?.key === 'clientId') { failed = true; throw new DOMException('No se pudo guardar la sesión de prueba.', 'QuotaExceededError') }
      return key === undefined ? put.call(this, value) : put.call(this, value, key)
    }
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0)
  await expect(page.locator('audio')).toHaveCount(1)
  expect(libraryRequests).toBe(1)
})

test('preserves a direct album URL and waits for its first response', async ({ page }) => {
  await fixtures(page)
  const pending = gate()
  await page.route('**/api/music/albums/startup-album', async route => { await pending.promise; await route.fulfill({ json: { id: 'startup-album', title: 'Mañana', artists: [], artwork: null, year: 2026, songs: [song] } }) })
  await page.goto('/music/album/startup-album')
  await expect(page.getByTestId('startup-screen')).toBeVisible()
  pending.release()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Mañana', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/music\/album\/startup-album$/)
})

test('opens cached music when the PC is disconnected', async ({ page }) => {
  await fixtures(page); await page.goto('/')
  await expect(page.getByRole('button', { name: 'Reproducir Al despertar', exact: true })).toBeVisible()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0)
  await page.route('**/api/library', route => route.fulfill({ status: 503 }))
  await page.reload()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0)
  await expect(page.getByText('Tu PC está desconectado. Tu música descargada sigue contigo.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reproducir Al despertar', exact: true })).toBeVisible()
})

test('opens cached music at once when the PC never answers, then reconnects on its own', async ({ page }) => {
  await fixtures(page); await page.goto('/')
  await expect(page.getByRole('button', { name: 'Reproducir Al despertar', exact: true })).toBeVisible()
  // An offline Tailscale peer: requests are accepted by the network stack but never answered.
  const pc = gate()
  for (const path of ['**/api/status', '**/api/library', '**/api/imports']) await page.route(path, async route => { await pc.promise; await route.fallback() })
  const started = Date.now()
  await page.reload()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0, { timeout: 6000 })
  expect(Date.now() - started).toBeLessThan(6000)
  await expect(page.getByText('Tu PC está desconectado. Tu música descargada sigue contigo.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reproducir Al despertar', exact: true })).toBeVisible()
  pc.release()
  await expect(page.getByText('Tu PC está desconectado. Tu música descargada sigue contigo.')).toHaveCount(0, { timeout: 15000 })
})

test('respects reduced motion during the opening', async ({ page }) => {
  await fixtures(page); await page.emulateMedia({ reducedMotion: 'reduce' })
  const pending = gate()
  await page.route('**/api/library', async route => { await pending.promise; await route.fulfill({ json: { tracks: [], youtubeSongs: [], playlists: [] } }) })
  await page.goto('/')
  await expect(page.getByTestId('startup-screen')).toBeVisible()
  expect(await page.locator('.startup-logo').evaluate(element => getComputedStyle(element).animationName)).toBe('none')
  pending.release()
  await expect(page.getByTestId('startup-screen')).toHaveCount(0)
})

test('renders the branded loader before JavaScript runs', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' })
  try {
    const page = await context.newPage(); await page.goto(baseURL!)
    await expect(page.locator('.openfy-boot')).toBeVisible()
    await expect(page.getByText('Abriendo tu música…')).toBeVisible()
    await expect(page.locator('.openfy-boot img')).toHaveJSProperty('complete', true)
  } finally { await context.close() }
})
