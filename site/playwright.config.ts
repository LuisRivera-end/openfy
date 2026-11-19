import { defineConfig, devices } from '@playwright/test'

// Runs against the production build (npm run build) served by `vite preview`.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5181' },
  webServer: { command: 'npx vite preview --host 127.0.0.1 --port 5181 --strictPort', url: 'http://127.0.0.1:5181', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } }
  ]
})
