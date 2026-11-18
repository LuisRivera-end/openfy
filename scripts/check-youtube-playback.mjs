// Opt-in real-provider regression: no remote audio is written to disk.
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.argv[2] || 'http://127.0.0.1:3187'
const id = process.argv[3] || 'J2kPH11Z4cM'
const query = 'Lady Gaga Bad Romance'
await mkdir('output/playwright', { recursive: true })
const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const report = { id, passed: false, requests: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('response', response => { if (response.url().includes(`/youtube/${id}/stream`)) report.requests.push({ status: response.status(), range: response.request().headers().range || null }) })
  const results = await (await fetch(new URL(`/api/music/search?q=${encodeURIComponent(query)}`, base))).json()
  const selected = results.songs.find(song => song.videoId === id)
  if (!selected) throw new Error('La pista exacta no apareció en la búsqueda real.')
  const occurrence = results.songs.filter(song => song.title === selected.title).findIndex(song => song.videoId === id)
  await page.goto(new URL('/search', base).href)
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music' }).fill(query)
  await page.getByRole('button', { name: `Reproducir ${selected.title}`, exact: true }).nth(occurrence).click()
  await page.waitForFunction(id => { const a = document.querySelector('audio'); return a?.currentSrc.includes(id) && !a.paused && a.currentTime > 2 }, id, { timeout: 45000 })
  await page.waitForTimeout(10000)
  report.beforeSeek = await page.locator('audio').evaluate(a => ({ position: a.currentTime, duration: a.duration, error: a.error?.code || null }))
  if (report.beforeSeek.error || report.beforeSeek.position < 10) throw new Error('La reproducción se interrumpió antes del salto.')
  await page.locator('audio').evaluate(a => { a.currentTime = a.duration * .55 })
  await page.waitForFunction(() => { const a = document.querySelector('audio'); return a.currentTime > a.duration * .55 + 1 && !a.paused }, null, { timeout: 45000 })
  report.afterSeek = await page.locator('audio').evaluate(a => ({ position: a.currentTime, duration: a.duration, error: a.error?.code || null }))
  await page.screenshot({ path: 'output/playwright/bad-romance-real.png' })
  report.passed = true
} catch (error) { report.error = error.message; process.exitCode = 1 }
finally { await browser.close(); await writeFile('output/playwright/youtube-real.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)) }
