import { describe, expect, it } from 'vitest'
import { AMBIENT, ambientFade, ambientMeanLuma, ambientPaletteTexture, ambientScrim, gradeAmbient } from '../../shared/utils/ambient'
import fixture from '../fixtures/ambient-contract.json'

describe('shared ambient contract', () => {
  it('uses the pinned parameters', () => { expect({ ...AMBIENT }).toEqual(fixture.parameters) })
  it('grades artwork colours', () => {
    for (const example of fixture.grade) gradeAmbient(example.rgb as [number, number, number]).forEach((value, i) => expect(value).toBeCloseTo(example.expected[i]!, 4))
  })
  it('darkens bright artwork only', () => { for (const example of fixture.scrim) expect(ambientScrim(example.luma)).toBeCloseTo(example.expected, 6) })
  it('eases the artwork cross-fade', () => { for (const example of fixture.fade) expect(ambientFade(example.elapsed)).toBeCloseTo(example.expected, 6) })
  it('builds the palette fallback texture', () => {
    const pixels = ambientPaletteTexture(fixture.palette.colors)
    expect(pixels.length).toBe(AMBIENT.textureSize ** 2 * 4)
    for (const sample of fixture.palette.samples) {
      const offset = (sample.y * AMBIENT.textureSize + sample.x) * 4
      expect([...pixels.slice(offset, offset + 3)]).toEqual(sample.rgb)
    }
  })
  it('measures mean luma and tolerates invalid palette entries', () => {
    expect(ambientMeanLuma(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]))).toBeCloseTo(.5, 6)
    expect([...ambientPaletteTexture(['nope', '', '#zzzzzz'], 2).slice(0, 3)]).toEqual([0x28, 0x48, 0x3e])
  })
})
