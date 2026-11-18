/** Capture installation before requestFullscreen changes display-mode. */
export default defineNuxtPlugin(() => {
  useState('openfy-installed-context', () =>
    ['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen'].some(mode => matchMedia(`(display-mode: ${mode})`).matches)
    || !!(navigator as Navigator & { standalone?: boolean }).standalone)
})
