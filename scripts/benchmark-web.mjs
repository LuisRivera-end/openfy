// A repeatable production-PWA benchmark. The harness process is excluded from
// resource totals; measure-desktop.ps1 counts only these two process trees.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { writeFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
const [scenario, data, ready, stop] = process.argv.slice(2)
const backend = spawn(process.execPath, ['scripts/serve.mjs'], {
  env: { ...process.env, NITRO_PORT: '4298', OPENFY_DATA_DIR: resolve(data) }, windowsHide: true, stdio: 'ignore',
})
let browser
try {
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch('http://127.0.0.1:4298/api/status')).ok) break } catch {}
    if (backend.exitCode !== null) throw new Error('Benchmark backend exited')
    await new Promise(r => setTimeout(r, 100))
  }
  browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
  const page = await browser.newPage({ viewport: { width: 1320, height: 880 } })
  await page.goto('http://127.0.0.1:4298/library', { waitUntil: 'networkidle' })
  if (scenario === 'playback') {
    const library = await (await fetch('http://127.0.0.1:4298/api/library')).json()
    const button = page.getByRole('button', { name: `Reproducir ${library.tracks[0].title}`, exact: true })
    await button.click()
    await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > .2 })
  }
  const session = await browser.newBrowserCDPSession()
  const info = await session.send('SystemInfo.getProcessInfo')
  await writeFile(ready, JSON.stringify({ roots: [backend.pid, Number(info.processInfo.find(p => p.type === 'browser').id)] }))
  for (;;) { try { await access(stop); break } catch {} await new Promise(r => setTimeout(r, 100)) }
} finally {
  await browser?.close()
  backend.kill('SIGTERM')
  await new Promise(r => { if (backend.exitCode !== null) r(); else backend.once('exit', r) })
}
