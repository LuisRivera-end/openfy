export type ByteRange = { start: number; end: number } | 'invalid' | null

/** A single RFC 9110 byte range. Multi-range requests are deliberately rejected. */
export function parseByteRange(header: string | undefined, size: number): ByteRange {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2]) || size < 1) return 'invalid'
  if (!match[1]) {
    const suffix = Number(match[2])
    return Number.isSafeInteger(suffix) && suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : 'invalid'
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return 'invalid'
  return { start, end }
}
