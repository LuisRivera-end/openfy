/**
 * Ambient lighting rules shared by the PWA WebGL renderer (app/lib/ambient-gl.ts) and the
 * native Direct3D renderer (Openfy.Core/Ambient.cs, Graphics/ReactiveSurface.cs).
 * Values are pinned by tests/fixtures/ambient-contract.json; change both sides together.
 */
export const AMBIENT = {
  textureSize: 64,
  lumaFloor: 0.04,
  lumaCeiling: 0.74,
  saturation: 1.4,
  scrimMin: 0.08,
  scrimMax: 0.4,
  scrimPivot: 0.38,
  scrimSlope: 0.8,
  lyricsScrim: 0.18,
  motionSpeed: 2.4,
  fadeSeconds: 1.2
} as const

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
export const ambientLuma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Keeps artwork blacks near black with a small lift for shadow detail, and tames bright covers. */
export function gradeAmbient([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const luma = ambientLuma(r, g, b), lifted = AMBIENT.lumaFloor + (AMBIENT.lumaCeiling - AMBIENT.lumaFloor) * luma
  return [clamp(lifted + (r - luma) * AMBIENT.saturation), clamp(lifted + (g - luma) * AMBIENT.saturation), clamp(lifted + (b - luma) * AMBIENT.saturation)]
}

/** Darkening applied over the graded artwork so white text keeps its contrast. */
export const ambientScrim = (meanLuma: number) => clamp(AMBIENT.scrimMin + (meanLuma - AMBIENT.scrimPivot) * AMBIENT.scrimSlope, AMBIENT.scrimMin, AMBIENT.scrimMax)

/** Eased 0..1 cross-fade progress between the previous and current artwork. */
export function ambientFade(elapsed: number) {
  const t = clamp(elapsed / AMBIENT.fadeSeconds)
  return t * t * (3 - 2 * t)
}

/** Mean luma (0..1) of an RGBA byte buffer. */
export function ambientMeanLuma(rgba: Uint8Array | Uint8ClampedArray) {
  let total = 0
  const count = Math.floor(rgba.length / 4)
  for (let i = 0; i < count * 4; i += 4) total += ambientLuma(rgba[i]! / 255, rgba[i + 1]! / 255, rgba[i + 2]! / 255)
  return count ? total / count : 0
}

function parseHex(value: string | undefined): [number, number, number] {
  const hex = /^#?([0-9a-f]{6})$/i.exec(value?.trim() || '')?.[1] || '28483e'
  const number = Number.parseInt(hex, 16)
  return [number >> 16 & 255, number >> 8 & 255, number & 255]
}

/** Square RGBA texture used when no artwork pixels are available (e.g. fixed YouTube palettes). */
export function ambientPaletteTexture(palette: readonly string[], size: number = AMBIENT.textureSize) {
  const [a, b, c] = [parseHex(palette[0]), parseHex(palette[1]), parseHex(palette[2])]
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1), v = y / (size - 1), offset = (y * size + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const across = a[channel]! + (b[channel]! - a[channel]!) * u
        pixels[offset + channel] = Math.round(across + (c[channel]! - across) * v)
      }
      pixels[offset + 3] = 255
    }
  }
  return pixels
}
