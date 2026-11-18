import sharp from 'sharp'

/** Remove only symmetric bars spanning an entire edge, preserving dark artwork. */
export async function squareVideoFrame(bytes: Buffer): Promise<Buffer> {
  let frame = bytes
  const { width: originalWidth = 1, height: originalHeight = 1 } = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()
  try {
    const trimmed = await sharp(bytes, { limitInputPixels: 40_000_000 }).trim({ background: '#000000', threshold: 28 }).toBuffer({ resolveWithObject: true })
    const left = -(trimmed.info.trimOffsetLeft || 0), top = -(trimmed.info.trimOffsetTop || 0)
    const right = originalWidth - left - trimmed.info.width, bottom = originalHeight - top - trimmed.info.height
    // A content bounding box can be highly asymmetric (a logo in one corner,
    // for example). Cropping it first moves the centre of the subsequent square.
    const horizontalBars = left <= 2 && right <= 2 && top > 0 && bottom > 0 && Math.abs(top - bottom) <= 2
    const verticalBars = top <= 2 && bottom <= 2 && left > 0 && right > 0 && Math.abs(left - right) <= 2
    if (horizontalBars || verticalBars) frame = trimmed.data
  } catch { /* A frame without bars (or entirely dark) stays as it is. */ }
  const { width = 1, height = 1 } = await sharp(frame).metadata()
  const side = Math.min(width, height)
  if (Math.abs(width - height) <= 2) return frame
  return sharp(frame).extract({ left: Math.floor((width - side) / 2), top: Math.floor((height - side) / 2), width: side, height: side }).toBuffer()
}
