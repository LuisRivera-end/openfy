import type { ArtistTheme } from '../types/music'

/** Sample side length; callers downscale artwork to SAMPLE × SAMPLE before calling artistTheme. */
export const ARTIST_THEME_SAMPLE = 16

const PIXEL_COUNT = ARTIST_THEME_SAMPLE ** 2
const BUCKET_COUNT = 12
const MAX_LUMINANCE = 0.14

type Rgb = [r: number, g: number, b: number]
type Hsl = [h: number, s: number, l: number]
interface Bucket { weight: number; r: number; g: number; b: number }

function toHsl(r: number, g: number, b: number): Hsl {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const chroma = max - min, lightness = (max + min) / 2
  if (chroma === 0) return [0, 0, lightness]
  const hue = 60 * (max === r ? (g - b) / chroma : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4)
  return [hue < 0 ? hue + 360 : hue, chroma / (1 - Math.abs(2 * lightness - 1)), lightness]
}

function toRgb([hue, saturation, lightness]: Hsl): Rgb {
  const amplitude = saturation * Math.min(lightness, 1 - lightness)
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12
    return lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [channel(0), channel(8), channel(4)]
}

function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function fitContrast(color: Hsl): Hsl {
  if (luminance(toRgb(color)) <= MAX_LUMINANCE) return color
  const [h, s, l] = color
  let low = 0, high = l
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2
    if (luminance(toRgb([h, s, mid])) <= MAX_LUMINANCE) low = mid
    else high = mid
  }
  return [h, s, low]
}

function bucketColor({ r, g, b, weight }: Bucket): Hsl {
  const [h, s, l] = toHsl(r / weight, g / weight, b / weight)
  return [h, Math.min(0.85, Math.max(0.45, s)), Math.min(0.60, Math.max(0.22, l))]
}

function hex(rgb: Rgb): string {
  return '#' + rgb.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
}

function theme(base: Hsl, secondary: Hsl, neutral: boolean): ArtistTheme {
  const [h, s, l] = fitContrast(base)
  const [r, g, b] = toRgb([h, s, l])
  // Keep the same contrast headroom for secondary text on hover and selection.
  const lighter: Rgb = [r + (1 - r) * 0.10, g + (1 - g) * 0.10, b + (1 - b) * 0.10]
  const surface: Rgb = luminance(lighter) <= MAX_LUMINANCE ? lighter : [r * 0.82, g * 0.82, b * 0.82]
  return {
    base: hex([r, g, b]),
    secondary: hex(toRgb(fitContrast(secondary))),
    deep: hex(toRgb([h, s, l * 0.45])),
    surface: hex(surface),
    neutral,
  }
}

/** Neutral slate used without artwork or for artwork with too little chroma. */
export const NEUTRAL_ARTIST_THEME = theme([215, 0.18, 0.30], [230, 0.14, 0.26], true)

/** Page colours from a 16×16 RGB(A) sample; `channels` is 3 (RGB) or 4 (RGBA). */
export function artistTheme(pixels: ArrayLike<number> | null | undefined, channels: 3 | 4 = 4): ArtistTheme {
  if (!pixels || pixels.length < PIXEL_COUNT * channels) return { ...NEUTRAL_ARTIST_THEME }
  const buckets = Array.from({ length: BUCKET_COUNT }, (): Bucket => ({ weight: 0, r: 0, g: 0, b: 0 }))
  let totalChroma = 0
  for (let i = 0; i < PIXEL_COUNT * channels; i += channels) {
    const r = pixels[i]! / 255, g = pixels[i + 1]! / 255, b = pixels[i + 2]! / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min
    totalChroma += chroma
    if (max < 0.08 || min > 0.92) continue
    const [hue] = toHsl(r, g, b)
    const bucket = buckets[Math.floor(hue / 30)]!
    bucket.weight += chroma
    bucket.r += chroma * r
    bucket.g += chroma * g
    bucket.b += chroma * b
  }

  let dominant = 0
  for (let i = 1; i < BUCKET_COUNT; i++) {
    if (buckets[i]!.weight > buckets[dominant]!.weight) dominant = i
  }
  const primary = buckets[dominant]!
  if (totalChroma / PIXEL_COUNT < 0.08 || primary.weight === 0) return { ...NEUTRAL_ARTIST_THEME }

  let alternate: Bucket | undefined
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const distance = Math.abs(i - dominant), bucket = buckets[i]!
    if (Math.min(distance, BUCKET_COUNT - distance) < 2 || bucket.weight < 0.15 * primary.weight) continue
    if (!alternate || bucket.weight > alternate.weight) alternate = bucket
  }
  const base = bucketColor(primary)
  const secondary: Hsl = alternate ? bucketColor(alternate) : [(base[0] + 20) % 360, base[1], base[2]]
  return theme(base, secondary, false)
}
