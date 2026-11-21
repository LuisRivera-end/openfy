type Rgb = [number, number, number]
interface Bucket { count: number; r: number; g: number; b: number }

const BASE = 0x09090B
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]
const SAMPLE = 64
/** Perceptual lightness and chroma ceilings of the page colour (OKLCH), matching Apple Music's dark appearance. */
const MAX_LIGHTNESS = 0.3
const MAX_CHROMA = 0.125
/** Secondary text is the page colour lifted by a fixed grey, so it keeps the album's hue. */
const MUTED_LIFT: Rgb = [161, 161, 166]
const MIN_MUTED_CONTRAST = 4.5

const round = (value: number) => Math.floor(value + 0.5)
const clampByte = (value: number) => Math.min(255, Math.max(0, value))
const hex = (rgb: Rgb) => '#' + rgb.map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
const mapRgb = ([r, g, b]: Rgb, map: (channel: number, index: number) => number): Rgb => [map(r, 0), map(g, 1), map(b, 2)]
const mix = (a: Rgb, b: Rgb, weight: number) => mapRgb(a, (channel, index) => round(((100 - weight) * channel + weight * b[index]!) / 100))

function linear(byte: number) {
  const s = byte / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function encode(value: number) {
  const v = Math.min(1, Math.max(0, value))
  return round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
}

function luminance([r, g, b]: Rgb) { return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) }
function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Lowers the perceptual lightness to 0.30 and caps the chroma at 0.125 in OKLab, keeping the hue, then clips per channel. */
function pageColor(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(linear) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  let A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  let B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const chroma = Math.hypot(A, B)
  if (chroma > MAX_CHROMA) { A *= MAX_CHROMA / chroma; B *= MAX_CHROMA / chroma }
  const L2 = Math.min(L, MAX_LIGHTNESS)
  const l2 = (L2 + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m2 = (L2 - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s2 = (L2 - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    encode(4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2),
    encode(-1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2),
    encode(-0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2)
  ]
}

export function albumTint(input?: string | null): { background: string; surface: string; muted: string; edge: string } {
  const digits = /^#?([0-9a-f]{6})$/i.exec(input?.trim() ?? '')?.[1]
  const value = digits ? Number.parseInt(digits, 16) : BASE
  const background = pageColor([value >> 16, (value >> 8) & 255, value & 255])
  const surface = mix(background, WHITE, 8)
  let muted = mapRgb(background, (channel, index) => clampByte(channel + MUTED_LIFT[index]!))
  for (let weight = 10; contrast(muted, surface) < MIN_MUTED_CONTRAST && weight <= 100; weight += 10) {
    muted = mix(mapRgb(background, (channel, index) => clampByte(channel + MUTED_LIFT[index]!)), WHITE, weight)
  }
  return { background: hex(background), surface: hex(surface), muted: hex(muted), edge: hex(mix(background, BLACK, 28)) }
}

/** Samples a centered square of the decoded 8-bit sRGB pixels. */
export function albumDominant(pixels: ArrayLike<number>, width: number, height: number, channels: 3 | 4): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length < width * height * channels) return null
  const side = Math.min(width, height), left = (width - side) / 2, top = (height - side) / 2
  const buckets: (Bucket | undefined)[] = Array(4096)
  for (let y = 0; y < SAMPLE; y++) {
    const row = Math.floor(top + (y + 0.5) * side / SAMPLE) * width
    for (let x = 0; x < SAMPLE; x++) {
      const index = (row + Math.floor(left + (x + 0.5) * side / SAMPLE)) * channels
      if (channels === 4 && pixels[index + 3]! < 128) continue
      const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!
      const bucketIndex = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4)
      const bucket = buckets[bucketIndex] ??= { count: 0, r: 0, g: 0, b: 0 }
      bucket.count++
      bucket.r += r
      bucket.g += g
      bucket.b += b
    }
  }
  let winner: Bucket | undefined
  for (const bucket of buckets) if (bucket && (!winner || bucket.count > winner.count)) winner = bucket
  if (!winner) return null
  const { count, r, g, b } = winner
  return hex([round(r / count), round(g / count), round(b / count)])
}
