import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// One page per language. Both load the same script; the language comes from <html lang>.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  server: { port: 5180, fs: { allow: [resolve(import.meta.dirname, '..')] } },
  preview: { port: 5181 },
  build: {
    target: 'es2022',
    rollupOptions: { input: { es: resolve(import.meta.dirname, 'index.html'), en: resolve(import.meta.dirname, 'en/index.html') } }
  }
})
