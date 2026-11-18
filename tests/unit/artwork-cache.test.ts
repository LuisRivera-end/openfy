import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ArtworkCache, artworkKey } from '../../server/utils/artwork-cache'
import { squareVideoFrame } from '../../server/utils/video-artwork'
import { artworkSize, largeArtworkUrl } from '../../shared/utils/artwork'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'openfy-artwork-test-')) })
afterEach(async () => { vi.useRealTimers(); await rm(root, { recursive: true, force: true }) })
const url = (id: number) => `https://lh3.googleusercontent.com/art${id}=w120-h120`
async function image(size: number) { return new Uint8Array(await sharp({ create: { width: size, height: size, channels: 3, background: '#3d5747' } }).png().toBuffer()) }

it('requests a larger source only once for concurrent variants, and reopens them offline', async () => {
  const bytes = await image(850)
  const request = vi.fn(async () => new Response(bytes))
  const cache = new ArtworkCache(root, root, () => new Set(), request)
  const [small, medium, large] = await Promise.all([128,512,1024].map(size => cache.prepare(url(0), size)))
  expect(request.mock.calls).toHaveLength(1)
  expect([small!.width, medium!.width, large!.width]).toEqual([128, 512, 850])
  const offline = new ArtworkCache(root, root, () => new Set(), async () => { throw Error('offline') })
  expect(await offline.prepare(url(0), 1024)).toEqual(large)
  await Promise.all([cache.prune(), offline.prune()])
})

it('keeps a pinned cover when evicting temporary entries and protects active reads', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const bytes = await image(16), pins = new Set([artworkKey(url(0))])
  const cache = new ArtworkCache(root, root, () => pins, async () => new Response(bytes), 1)
  const retained = await cache.prepare(url(0)), temporary = await cache.prepare(url(1))
  await cache.prune(); expect((await stat(temporary.path)).size).toBeGreaterThan(0)
  vi.setSystemTime(Date.now() + 180_000)
  await cache.prune()
  expect((await stat(retained.path)).isFile()).toBe(true)
  await expect(stat(temporary.path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('reuses 601 covers after scrolling in both directions and across a fresh service', async () => {
  const bytes = await image(8)
  const request = vi.fn(async () => new Response(bytes))
  const cache = new ArtworkCache(root, root, () => new Set(), request)
  const ids = Array.from({length: 601}, (_, i) => i)
  for (let i = 0; i < ids.length; i += 16) await Promise.all(ids.slice(i, i + 16).map(id => cache.prepare(url(id), 128)))
  expect(await readdir(root)).toHaveLength(601)
  const next = new ArtworkCache(root, root, () => new Set(), request)
  ids.reverse()
  for (let i = 0; i < ids.length; i += 16) await Promise.all(ids.slice(i, i + 16).map(id => next.prepare(url(id), 128)))
  expect(request).toHaveBeenCalledTimes(601)
  await Promise.all([cache.prune(), next.prune()])
}, 90000)

it('asks the provider for 2048 px banners, maxres video frames and keeps square covers at 1024', () => {
  expect(largeArtworkUrl('https://lh3.googleusercontent.com/banner=w2880-h1200-p-l90-rj')).toBe('https://lh3.googleusercontent.com/banner=w2048-h853-p-l90-rj')
  expect(largeArtworkUrl('https://lh3.googleusercontent.com/cover=w120-h120-l90-rj')).toBe('https://lh3.googleusercontent.com/cover=w1024-h1024-l90-rj')
  expect(largeArtworkUrl('https://i.ytimg.com/vi/RGXHqQR9XrQ/hqdefault.jpg?sqp=abc&rs=def')).toBe('https://i.ytimg.com/vi/RGXHqQR9XrQ/maxresdefault.jpg')
  expect([artworkSize(900), artworkSize(1500)]).toEqual([1024, 2048])
})

it('removes letterbox bars from video frames and crops them square', async () => {
  // A 480×360 frame: 45 px black bars above and below a 480×270 picture.
  const picture = await sharp({ create: { width: 480, height: 270, channels: 3, background: '#c0603a' } }).png().toBuffer()
  const frame = await sharp({ create: { width: 480, height: 360, channels: 3, background: '#000000' } }).composite([{ input: picture, top: 45, left: 0 }]).jpeg().toBuffer()
  const square = await sharp(await squareVideoFrame(frame)).stats()
  const { width, height } = await sharp(await squareVideoFrame(frame)).metadata()
  expect(width).toBe(height)
  expect(width).toBeGreaterThanOrEqual(266)
  expect(square.channels[0]!.min).toBeGreaterThan(150) // no black rows left
  const request = vi.fn(async (target: string | URL | Request) => String(target).includes('maxresdefault') ? new Response('', { status: 404 }) : new Response(new Uint8Array(frame)))
  const cache = new ArtworkCache(root, root, () => new Set(), request as typeof fetch)
  const art = await cache.prepare('https://i.ytimg.com/vi/RGXHqQR9XrQ/hqdefault.jpg', 512)
  expect(art.width).toBe(art.height)
  expect(request).toHaveBeenCalledTimes(2)
  await cache.prepare('https://i.ytimg.com/vi/RGXHqQR9XrQ/hqdefault.jpg', 512)
  expect(request).toHaveBeenCalledTimes(2) // a missing maxres frame is not retried
})

it('preserves the centre of dark artwork with a logo in one corner', async () => {
  const frame = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="black"/><circle cx="640" cy="360" r="60" fill="white"/><rect x="70" y="600" width="230" height="50" fill="white"/></svg>')).jpeg().toBuffer()
  const square = await squareVideoFrame(frame)
  expect(await sharp(square).metadata()).toMatchObject({ width: 720, height: 720 })
  const centre = await sharp(square).extract({ left: 360, top: 360, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
  expect([...centre].every(channel => channel > 240)).toBe(true)
})

it('removes symmetric pillarbox bars without cropping a dark square design', async () => {
  const picture = await sharp({ create: { width: 270, height: 360, channels: 3, background: '#c0603a' } }).png().toBuffer()
  const frame = await sharp({ create: { width: 480, height: 360, channels: 3, background: '#000000' } }).composite([{ input: picture, top: 0, left: 105 }]).png().toBuffer()
  expect(await sharp(await squareVideoFrame(frame)).metadata()).toMatchObject({ width: 270, height: 270 })
  const square = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="black"/><circle cx="200" cy="200" r="40" fill="white"/></svg>')).png().toBuffer()
  expect(await squareVideoFrame(square)).toEqual(square)
})

it('upgrades a v2 video crop while keeping non-video v2 artwork available offline', async () => {
  const video = 'https://i.ytimg.com/vi/RGXHqQR9XrQ/hqdefault.jpg'
  const request = vi.fn(async () => new Response(await image(32)))
  const cache = new ArtworkCache(root, root, () => new Set(), request)
  const oldVideo = await cache.prepare(video, 128), cover = await cache.prepare(url(0), 128)
  for (const art of [oldVideo, cover]) {
    const file = join(root, art.key, 'metadata.json'), metadata = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...metadata, version: 2 }))
  }
  const refresh = vi.fn(async () => new Response(await image(64)))
  const next = new ArtworkCache(root, root, () => new Set(), refresh)
  expect((await next.prepare(video, 128)).width).toBe(64)
  expect(refresh).toHaveBeenCalledTimes(1)
  const offline = new ArtworkCache(root, root, () => new Set(), async () => { throw Error('offline') })
  expect(await offline.prepare(url(0), 128)).toEqual(cover)
})
