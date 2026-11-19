// Captures review screenshots of the built site (run `npm run build` and `npx vite preview --port 5181` first).
// Usage: node tests/capture.mjs <outDir>
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const out = resolve(process.argv[2] ?? 'test-results/shots')
await mkdir(out, { recursive: true })
const base = 'http://127.0.0.1:5181'
const shots = [
  { width: 1440, height: 900, lang: '', scheme: 'dark', at: [['top', 0], ['features', 0.05], ['features', 0.8], ['library', 0.05], ['lyrics', 0.4], ['offline', 0.15], ['big-picture', 0.55], ['how', 0.15], ['download', 0.15], ['news', 0.05]] },
  { width: 1440, height: 900, lang: '', scheme: 'light', at: [['privacy', 0.1], ['download', 0.15], ['news', 0.05]] },
  { width: 1440, height: 900, lang: 'en/', scheme: 'dark', at: [['top', 0]] },
  { width: 768, height: 1024, lang: '', scheme: 'dark', at: [['features', 0.1], ['how', 0.1], ['download', 0.1]] },
  { width: 375, height: 812, lang: 'en/', scheme: 'dark', at: [['top', 0], ['features', 0.02], ['offline', 0.2], ['how', 0.2], ['download', 0.1]] }
]

const browser = await chromium.launch()
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, colorScheme: shot.scheme, deviceScaleFactor: 1 })
  await page.goto(base + '/' + shot.lang, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  for (const [id, frac] of shot.at) {
    await page.evaluate(async ([id, frac]) => {
      const el = document.getElementById(id)
      const top = el.getBoundingClientRect().top + scrollY
      window.scrollTo(0, top + el.offsetHeight * frac)
    }, [id, frac])
    await page.waitForTimeout(2200)
    const name = `${shot.width}-${shot.scheme}-${shot.lang ? 'en' : 'es'}-${id}-${Math.round(frac * 100)}.png`
    await page.screenshot({ path: resolve(out, name) })
    console.log(name)
  }
  await page.close()
}
await browser.close()
