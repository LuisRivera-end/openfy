import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { extname, join, basename } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dataPaths, getDatabase } from '../../database'
import { imports } from '../../database/schema'
import { MAX_UPLOAD_BYTES, SUPPORTED_EXTENSIONS } from '../../utils/importer'
import { wakeWorkers } from '../../utils/workers'

export default defineEventHandler(async (event) => {
  const filename = basename(String(getQuery(event).filename || '').replaceAll('\\', '/')).slice(0, 255)
  if (!SUPPORTED_EXTENSIONS.has(extname(filename).toLowerCase())) {
    throw createError({ statusCode: 415, message: 'Selecciona archivos MP3, AAC, M4A o FLAC.' })
  }
  const length = Number(getHeader(event, 'content-length'))
  if (length > MAX_UPLOAD_BYTES) throw createError({ statusCode: 413, message: 'El límite es 1 GB por archivo.' })
  const id = randomUUID()
  const stagingPath = join(dataPaths().staging, `${id}${extname(filename).toLowerCase()}`)
  let bytes = 0
  try {
    await pipeline(event.node.req, new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length
      callback(bytes > MAX_UPLOAD_BYTES ? new Error('upload-too-large') : null, chunk)
    } }), createWriteStream(stagingPath, { flags: 'wx' }))
    if (!bytes) throw new Error('empty-file')
    const job = { id, filename, stagingPath, state: 'processing' as const, trackId: null, error: null, createdAt: Date.now() }
    getDatabase().insert(imports).values(job).run()
    wakeWorkers()
    setResponseStatus(event, 202)
    const { stagingPath: _path, ...result } = job
    return result
  } catch {
    await rm(stagingPath, { force: true }).catch(() => {})
    throw createError({ statusCode: bytes > MAX_UPLOAD_BYTES ? 413 : 400,
      message: bytes > MAX_UPLOAD_BYTES ? 'El límite es 1 GB por archivo.' : 'No se pudo guardar el archivo. Revisa el espacio del PC e inténtalo de nuevo.' })
  }
})
