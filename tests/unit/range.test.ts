import { describe, expect, it } from 'vitest'
import { parseByteRange } from '../../server/utils/range'

describe('HTTP byte ranges', () => {
  it('returns the whole response when Range is absent', () => expect(parseByteRange(undefined, 100)).toBeNull())
  it.each([
    ['bytes=0-1', { start: 0, end: 1 }], ['bytes=90-', { start: 90, end: 99 }],
    ['bytes=0-500', { start: 0, end: 99 }], ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=-200', { start: 0, end: 99 }],
  ])('handles %s', (range, expected) => expect(parseByteRange(range as string, 100)).toEqual(expected))
  it.each(['bytes=100-', 'bytes=9-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-6', 'items=0-1', 'bytes=999999999999999999999-'])('rejects %s', range => expect(parseByteRange(range, 100)).toBe('invalid'))
  it('rejects ranges for empty files', () => expect(parseByteRange('bytes=0-', 0)).toBe('invalid'))
})
