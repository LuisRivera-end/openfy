import { describe, expect, it } from 'vitest'
import { albumDominant, albumTint } from '../../shared/utils/album-tint'
import contract from '../fixtures/album-tint-contract.json'

describe('album tint contract', () => {
  it.each(contract.tint)('grades $input', ({ input, expected }) => {
    expect(albumTint(input)).toEqual(expected)
  })

  it('uses the neutral base for missing input', () => {
    expect(albumTint()).toEqual(albumTint('#09090B'))
    expect(albumTint(null)).toEqual(albumTint('#09090B'))
  })

  it.each(contract.dominant)('samples $name', ({ width, height, channels, pixels, expected }) => {
    expect(albumDominant(Uint8Array.from(pixels), width, height, channels as 3 | 4)).toBe(expected)
  })

  it('returns no color for a missing pixel buffer', () => {
    expect(albumDominant([], 1, 1, 4)).toBeNull()
  })
})
