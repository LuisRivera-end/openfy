let context: AudioContext | undefined, analyser: AnalyserNode | undefined, source: MediaElementAudioSourceNode | undefined
let spectrum: Uint8Array<ArrayBuffer> | undefined, animation = 0, previous = 0, bass = 0, mid = 0, high = 0
/** This graph is attached once. Never suspend it while the media element can play. */
export function connectAudioAnalysis(audio: HTMLAudioElement) {
  try {
    if (!context) {
      context = new AudioContext()
      analyser = context.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0
      source = context.createMediaElementSource(audio); source.connect(analyser); analyser.connect(context.destination)
      spectrum = new Uint8Array(analyser.frequencyBinCount)
    }
    if (context.state === 'suspended') void context.resume().catch(() => {})
  } catch { /* Playback remains the primary capability. */ }
}
/**
 * Only the CSS fallback reads the bands as custom properties. They are written on that element, never on <html>:
 * changing a root custom property every frame restyles the whole page. Touch devices sample at 30 FPS, like the
 * WebGL ambient that reads `audioBands()`.
 */
const fallbacks = () => document.querySelectorAll<HTMLElement>('.ambient.fallback')
export function ambientAnalysis(enabled: boolean) {
  cancelAnimationFrame(animation)
  if (!enabled || !analyser || !context || !spectrum) {
    bass = mid = high = 0
    for (const element of fallbacks()) for (const band of ['bass', 'mid', 'high']) element.style.setProperty('--audio-' + band, '0')
    return
  }
  previous = performance.now()
  const interval = matchMedia('(pointer: coarse)').matches ? 1000 / 30 - 2 : 0
  function tick(now: number) {
    if (!analyser || !context || !spectrum) return
    if (interval && now - previous < interval) { animation = requestAnimationFrame(tick); return }
    analyser.getByteFrequencyData(spectrum)
    const bands = [0, 0, 0], counts = [0, 0, 0]
    for (let i = 1; i < spectrum.length; i++) {
      const hz = i * context.sampleRate / analyser.fftSize, band = hz < 250 ? 0 : hz < 2500 ? 1 : 2
      bands[band]! += spectrum[i]! / 255; counts[band]!++
    }
    const dt = Math.min(.1, (now - previous) / 1000); previous = now
    const envelope = (value: number, target: number) => value + (target - value) * (1 - Math.exp(-dt / (target > value ? .06 : .26)))
    bass = envelope(bass, bands[0]! / Math.max(1, counts[0]!)); mid = envelope(mid, bands[1]! / Math.max(1, counts[1]!)); high = envelope(high, bands[2]! / Math.max(1, counts[2]!))
    for (const element of fallbacks()) for (const [band, value] of [['bass', bass], ['mid', mid], ['high', high]] as const) element.style.setProperty('--audio-' + band, value.toFixed(3))
    animation = requestAnimationFrame(tick)
  }
  animation = requestAnimationFrame(tick)
}
/** Current enveloped band levels (0..1), read by the WebGL ambient renderer every frame. */
export const audioBands = () => ({ bass, mid, high })
