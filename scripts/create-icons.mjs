import sharp from 'sharp'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const webIcons = new URL('../public/icons/', import.meta.url)
const windowsIcons = new URL('../desktop/Openfy.Windows/Assets/', import.meta.url)
const logo = await readFile(new URL('openfy.svg', webIcons), 'utf8')
// iOS and maskable launchers apply their own corner mask to an opaque square.
const squareLogo = logo.replace(' rx="112"', '')

function png(size, square = false) {
  // Render the vector at the target resolution, including sizes above 512px.
  return sharp(Buffer.from(square ? squareLogo : logo), { density: 72 * size / 512 })
    .resize(size, size).png().toBuffer()
}

await mkdir(windowsIcons, { recursive: true })
for (const size of [192, 512, 1024]) {
  await writeFile(new URL(`icon-${size}.png`, webIcons), await png(size))
}
await writeFile(new URL('maskable-512.png', webIcons), await png(512, true))
await writeFile(new URL('apple-touch-icon.png', webIcons), await png(1024, true))
for (const size of [120, 152, 167, 180]) {
  await writeFile(new URL(`apple-touch-icon-${size}.png`, webIcons), await png(size, true))
}
await writeFile(new URL('Openfy.png', windowsIcons), await png(1024))

// Include exact sizes for Windows shell surfaces and common display scales.
const sizes = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]
const directory = Buffer.alloc(6 + sizes.length * 16)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(sizes.length, 4)
const images = []
let offset = directory.length
for (const [index, size] of sizes.entries()) {
  const image = await png(size)
  const entry = 6 + index * 16
  directory.writeUInt8(size === 256 ? 0 : size, entry)
  directory.writeUInt8(size === 256 ? 0 : size, entry + 1)
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(image.length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  images.push(image)
  offset += image.length
}
await writeFile(new URL('Openfy.ico', windowsIcons), Buffer.concat([directory, ...images]))
