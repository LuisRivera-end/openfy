import { describe, expect, it } from 'vitest'
import { ARTIST_THEME_SAMPLE, NEUTRAL_ARTIST_THEME, artistTheme } from '../../shared/utils/artist-theme'
import fixtures from '../fixtures/artist-theme-contract.json'

const colorKeys = ['base', 'secondary', 'deep', 'surface'] as const
const rgb = (hex: string) => [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))

function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(byte => {
    const c = byte / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

describe('artist theme contract', () => {
  it.each(fixtures)('$name', ({ pixels, expected }) => {
    expect(pixels).toHaveLength(ARTIST_THEME_SAMPLE ** 2 * 3)
    const actual = artistTheme(pixels, 3)
    expect(actual.neutral).toBe(expected.neutral)
    for (const key of colorKeys) {
      expect(actual[key]).toMatch(/^#[0-9a-f]{6}$/)
      const channels = rgb(expected[key])
      rgb(actual[key]).forEach((value, index) => expect(Math.abs(value - channels[index]!)).toBeLessThanOrEqual(2))
    }
    for (const key of colorKeys) {
      expect((luminance('#ededf0') + 0.05) / (luminance(actual[key]) + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
    const rgba = Uint8Array.from({ length: ARTIST_THEME_SAMPLE ** 2 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : pixels[Math.floor(i / 4) * 3 + i % 4]!)
    expect(artistTheme(rgba)).toEqual(actual)
  })

  it('uses the same neutral theme without a sample', () => {
    expect(artistTheme(null)).toEqual(NEUTRAL_ARTIST_THEME)
  })

  it('keeps secondary text and glass controls readable across bright hues', () => {
    for (let red = 0; red <= 255; red += 51) {
      for (let green = 0; green <= 255; green += 51) {
        for (let blue = 0; blue <= 255; blue += 51) {
          const sample = Array.from({ length: ARTIST_THEME_SAMPLE ** 2 }, () => [red, green, blue]).flat()
          const theme = artistTheme(sample, 3)
          for (const key of colorKeys) {
            expect((luminance('#ededf0') + 0.05) / (luminance(theme[key]) + 0.05)).toBeGreaterThanOrEqual(4.5)
          }
          const glass = '#' + rgb(theme.deep).map(channel => Math.round(channel * 0.82 + 255 * 0.18).toString(16).padStart(2, '0')).join('')
          expect(1.05 / (luminance(glass) + 0.05)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})
