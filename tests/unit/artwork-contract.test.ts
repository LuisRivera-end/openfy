import { expect, test } from 'vitest'
import { artworkIdentity, largeArtworkUrl } from '../../shared/utils/artwork'
import fixture from '../fixtures/artwork-contract.json'

test.each(fixture.cases)('artwork renditions and identity for $input', ({ input, large, identity }) => {
  expect(largeArtworkUrl(input)).toBe(large)
  expect(artworkIdentity(input)).toBe(identity)
})
