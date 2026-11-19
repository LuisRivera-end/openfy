import { createAmbientRenderer, PHONE_AMBIENT, type AmbientRenderer } from '../../../app/lib/ambient-gl'
import { coverPixels, realCoverUrl } from './media'

const MAX_RENDERERS = 2
const THRESHOLD = .01

export function watchAmbient(root: ParentNode) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const coarse = matchMedia('(pointer: coarse)')
  const visible = new Set<HTMLCanvasElement>()
  const failed = new WeakSet<HTMLCanvasElement>()
  const live = new Map<HTMLCanvasElement, AmbientRenderer>()

  function dispose(canvas: HTMLCanvasElement) {
    live.get(canvas)?.dispose()
    live.delete(canvas)
    canvas.parentElement?.classList.add('no-gl')
  }

  function fallback(canvas: HTMLCanvasElement) {
    failed.add(canvas)
    dispose(canvas)
  }

  async function start(canvas: HTMLCanvasElement) {
    let renderer: AmbientRenderer | null
    try {
      renderer = createAmbientRenderer(canvas, () => {
        fallback(canvas)
        sync()
      }, coarse.matches ? PHONE_AMBIENT : { resolution: .6, maxFps: 45 })
    } catch {
      renderer = null
    }
    if (!renderer) {
      fallback(canvas)
      return
    }

    live.set(canvas, renderer)
    renderer.resize()
    try {
      const pixels = await coverPixels(realCoverUrl(Number(canvas.dataset.cover), 'small'))
      if (live.get(canvas) !== renderer) return
      renderer.setArtwork(pixels, true)
      renderer.setActive(!document.hidden)
      canvas.parentElement?.classList.remove('no-gl')
    } catch {
      if (live.get(canvas) !== renderer) return
      fallback(canvas)
      sync()
    }
  }

  function sync() {
    const wanted = reduced.matches ? [] : [...visible].filter(canvas => !failed.has(canvas))
    // Entering canvases go at the end of the set, so the oldest yields its slot first.
    const newest = wanted.slice(-MAX_RENDERERS)
    for (const canvas of [...live.keys()]) {
      if (!newest.includes(canvas)) dispose(canvas)
    }
    if (document.hidden) {
      for (const renderer of live.values()) renderer.setActive(false)
      return
    }
    for (const canvas of wanted.reverse()) {
      const renderer = live.get(canvas)
      if (renderer) renderer.setActive(true)
      else if (live.size < MAX_RENDERERS) void start(canvas)
      else break
    }
  }

  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const canvas = entry.target as HTMLCanvasElement
      if (entry.isIntersecting && entry.intersectionRatio >= THRESHOLD) visible.add(canvas)
      else visible.delete(canvas)
    }
    sync()
  }, { threshold: THRESHOLD })
  const resize = new ResizeObserver(entries => {
    for (const entry of entries) live.get(entry.target as HTMLCanvasElement)?.resize()
  })
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('.device-ambient')) {
    intersection.observe(canvas)
    resize.observe(canvas)
  }
  document.addEventListener('visibilitychange', sync)
  reduced.addEventListener('change', sync)
}
