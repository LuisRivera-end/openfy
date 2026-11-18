import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const metadata = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const port = process.env.OPENFY_TEST_PORT || '4175'
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 45000,
  expect: { timeout: 10000 }, reporter: 'list',
  // The suite opens fresh profiles; mark this version's "Novedades" as seen so the dialog only appears in release-notes.spec.ts.
  // The iPhone expanded player opens on the artwork; most specs read its lyrics, so they start with the lyrics view chosen
  // (immersive.spec.ts and mobile.spec.ts clear it to cover the default).
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', storageState: { cookies: [], origins: [{ origin: baseURL, localStorage: [{ name: 'openfy-release-seen', value: metadata.version }, { name: 'openfy-immersive-lyrics', value: 'on' }] }] } },
  webServer: {
    command: 'node tests/helpers/server.mjs', url: baseURL + '/api/status', reuseExistingServer: false,
    env: { NITRO_HOST: '127.0.0.1', NITRO_PORT: port, OPENFY_DATA_DIR: join(tmpdir(), `openfy-e2e-${Date.now()}`), OPENFY_ORIGIN: 'https://openfy-test.example', OPENFY_METADATA_LOOKUP: 'off', OPENFY_LYRICS_BACKFILL: 'off', OPENFY_MOTION_ART: 'off' },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' as const } },
  ],
})
