import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { parseFile } from 'music-metadata'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { dataPaths, getDatabase } from '../database'
import { assets, imports, tracks } from '../database/schema'
import { embeddedLyrics } from './embedded-lyrics'

export const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.flac'])
export const MAX_UPLOAD_BYTES = 1024 ** 3

export async function fileHash(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function importFile(jobId: string) {
  const db = getDatabase()
  const job = db.select().from(imports).where(eq(imports.id, jobId)).get()
  if (!job || job.state !== 'processing') return
  let originalPath: string | undefined
  try {
    const extension = extname(job.filename).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error('Formato no compatible. Usa MP3, AAC, M4A o FLAC.')
    const hash = await fileHash(job.stagingPath)
    const duplicate = db.select().from(tracks).where(eq(tracks.hash, hash)).get()
    if (duplicate) {
      db.update(imports).set({ state: 'duplicate', trackId: duplicate.id }).where(eq(imports.id, jobId)).run()
      return
    }
    const metadata = await parseFile(job.stagingPath, { duration: true })
    const codec = metadata.format.codec || ''
    const isFlac = /FLAC/i.test(codec)
    const isMp3 = /MPEG.*Layer\s*3|MP3/i.test(codec)
    const isAac = /AAC/i.test(codec)
    const duration = metadata.format.duration || 0
    if (!duration || ![isFlac, isMp3, isAac].some(Boolean)) {
      throw new Error('El archivo no contiene audio MP3, AAC o FLAC válido.')
    }
    if ((extension === '.flac' && !isFlac) || (extension === '.mp3' && !isMp3)
      || (['.aac', '.m4a'].includes(extension) && !isAac) || (isFlac && extension !== '.flac')) {
      throw new Error('La extensión no corresponde al formato del archivo.')
    }
    const id = randomUUID()
    const assetId = randomUUID()
    const filename = `${assetId}${extension}`
    const info = await stat(job.stagingPath)
    const common = metadata.common
    const album = common.album?.trim() || 'Sin álbum'
    const artist = common.artist?.trim() || 'Artista desconocido'
    const albumArtist = common.albumartist?.trim() || artist
    const albumId = createHash('sha256').update(`${albumArtist.toLowerCase()}\0${album.toLowerCase()}`).digest('hex').slice(0, 24)
    let artwork: string | null = null
    let palette = ['#28483e', '#18212e', '#111113']
    const picture = common.picture?.[0]
    if (picture && picture.data.length <= 20 * 1024 ** 2) {
      try {
        const image = sharp(picture.data, { limitInputPixels: 40_000_000 }).rotate()
        const webp = await image.clone().resize(1000, 1000, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
        const artHash = createHash('sha256').update(webp).digest('hex')
        await writeFile(join(dataPaths().artwork, `${artHash}.webp`), webp)
        artwork = `/api/artwork/${artHash}.webp`
        const { data } = await image.clone().resize(3, 1, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
        palette = Array.from({ length: 3 }, (_, i) => `#${Buffer.from(data.subarray(i * 3, i * 3 + 3)).toString('hex')}`)
      } catch { /* Invalid artwork must not reject otherwise valid audio. */ }
    }
    originalPath = join(dataPaths().originals, filename)
    await rename(job.stagingPath, originalPath)
    db.transaction(tx => {
      tx.insert(assets).values({ id: assetId, filename, mime: isFlac ? 'audio/flac' : isMp3 ? 'audio/mpeg' : extension === '.aac' ? 'audio/aac' : 'audio/mp4', bytes: info.size, hash, variant: 'original' }).run()
      tx.insert(tracks).values({
        id, hash, originalId: assetId, mobileId: isFlac ? null : assetId,
        embeddedLyrics: embeddedLyrics(common.lyrics), lyricsScanned: true, genresScanned: true,
        conversion: isFlac ? 'pending' : 'ready', conversionProgress: isFlac ? 0 : 100,
        metadata: {
          id, title: common.title?.trim() || basename(job.filename, extension), artist, albumArtist, album, albumId,
          genres: [...new Set((common.genre || []).map(value => value.trim()).filter(Boolean))],
          duration, trackNumber: common.track.no || 0, disc: common.disk.no || 1,
          year: common.year || null, format: isFlac ? 'FLAC' : isMp3 ? 'MP3' : 'AAC',
          artwork, palette, addedAt: Date.now(),
        },
      }).run()
      tx.update(imports).set({ state: 'complete', trackId: id }).where(eq(imports.id, jobId)).run()
    })
    originalPath = undefined
  } catch (error) {
    const message = error instanceof Error && /^(Formato|El archivo|La extensión)/.test(error.message)
      ? error.message : 'No se pudo importar. Comprueba que el archivo no esté dañado y que haya espacio en el PC.'
    db.update(imports).set({ state: 'failed', error: message }).where(eq(imports.id, jobId)).run()
    if (originalPath) await rm(originalPath, { force: true })
  } finally {
    await rm(job.stagingPath, { force: true }).catch(() => {})
  }
}
