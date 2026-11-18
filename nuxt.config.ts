import metadata from './package.json'
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-11',
  ssr: false,
  spaLoadingTemplate: 'spa-loading-template.html',
  ...(process.env.OPENFY_BUILD_DIR ? { buildDir: process.env.OPENFY_BUILD_DIR } : {}),
  runtimeConfig: { public: { release: { version: metadata.version, build: Number(process.env.OPENFY_BUILD || 1) } } },
  devtools: { enabled: false },
  modules: ['@pinia/nuxt', '@vite-pwa/nuxt'],
  css: ['~/assets/main.css'],
  vite: { plugins: [tailwindcss()] },
  app: {
    // Page transitions; main.css limits the visible animation to the phone layout (iOS-style push and tab fade).
    viewTransition: true,
    head: {
      title: 'Openfy · Tu música, contigo',
      htmlAttrs: { lang: 'es' },
      script: [{ innerHTML: `try { if (localStorage.getItem('openfy-motion') === 'off') document.documentElement.classList.add('reduce-motion') } catch {}` }],
      meta: [
        { name: 'theme-color', content: '#09090b' },
        // Openfy is dark by design; declaring it before the CSS loads keeps Safari's Adaptive Dark Mode away.
        { name: 'color-scheme', content: 'dark' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Tu biblioteca musical personal, dentro y fuera de casa.' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', sizes: 'any', href: '/icons/openfy.svg' },
        { rel: 'apple-touch-icon', sizes: '1024x1024', href: '/icons/apple-touch-icon.png' },
        ...[120, 152, 167, 180].map(size => ({
          rel: 'apple-touch-icon' as const, sizes: `${size}x${size}`, href: `/icons/apple-touch-icon-${size}.png`,
        })),
      ],
    },
  },
  nitro: {
    preset: 'node-server',
    ...(process.env.OPENFY_BUILD_OUTPUT ? { output: { dir: process.env.OPENFY_BUILD_OUTPUT } } : {}),
    prerender: { routes: ['/'] },
    externals: {
      external: ['better-sqlite3', 'ffmpeg-static', 'sharp'],
      traceInclude: ['node_modules/ffmpeg-static/ffmpeg.exe', 'node_modules/ffmpeg-static/ffmpeg'],
    },
  },
  pwa: {
    strategies: 'injectManifest',
    srcDir: 'service-worker',
    filename: 'sw.ts',
    registerType: 'prompt',
    client: { installPrompt: false },
    manifest: {
      name: 'Openfy', short_name: 'Openfy', lang: 'es',
      description: 'Tu música, contigo.',
      theme_color: '#09090b', background_color: '#09090b',
      display: 'standalone', start_url: '/', scope: '/',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    injectManifest: {
      buildPlugins: { vite: [{ name: 'openfy-sw-release', config: () => ({ define: { __OPENFY_RELEASE__: JSON.stringify(metadata.version + '+' + (process.env.OPENFY_BUILD || 1)) } }) }] },
      globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
    devOptions: { enabled: false },
  },
})
