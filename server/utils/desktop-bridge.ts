import { connect } from 'node:net'
import { randomUUID } from 'node:crypto'
import { copyFile, opendir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { dataPaths, getDatabase } from '../database'
import { assets, imports } from '../database/schema'
import { desktopEvents, notifyDesktop } from './desktop-events'
import { wakeWorkers } from './workers'
import { MAX_UPLOAD_BYTES, SUPPORTED_EXTENSIONS } from './importer'
import { readTracks } from './library'
import { DESKTOP_PROTOCOL, type DesktopRequest } from '../../shared/types/desktop'
import { prepareArtwork } from './artwork-cache'
import { updateReadiness, beginMaintenance, cancelMaintenance, isMaintenance } from './update-maintenance'
import { createPairing, listSyncDevices, revokeSyncDevice } from './device-sync'

async function importPaths(paths: unknown) {
  if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string')) throw new Error('Selecciona archivos o carpetas válidos.')
  let count = 0
  async function add(path: string) {
    const info = await stat(path)
    if (info.isDirectory()) {
      for await (const child of await opendir(path)) if (!child.isSymbolicLink()) await add(join(path, child.name))
      return
    }
    const extension = extname(path).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(extension) || info.size > MAX_UPLOAD_BYTES || !info.size) return
    const id = randomUUID(), stagingPath = join(dataPaths().staging, id + extension)
    await copyFile(path, stagingPath)
    getDatabase().insert(imports).values({ id, filename: basename(path), stagingPath, state: 'processing', createdAt: Date.now() }).run()
    count++
    wakeWorkers()
    notifyDesktop('importProgress', { imported: count, filename: basename(path) })
  }
  for (const path of paths) await add(path)
  return { count }
}

export function startDesktopBridge() {
  const pipe = process.env.OPENFY_DESKTOP_PIPE
  if (!pipe) return () => {}
  if (process.platform !== 'win32' || !/^\\\\\.\\pipe\\openfy-[a-f0-9-]+$/.test(pipe)) throw new Error('Canal de escritorio no válido.')
  const socket = connect(pipe)
  const send = (value: unknown) => { if (!socket.destroyed) socket.write(JSON.stringify(value) + '\n') }
  const listener = (event: { type: string; payload: { trackIds?: string[] } }) => {
    if (event.type === 'libraryChanged' && event.payload.trackIds?.length) send({ event: { type: 'tracksChanged', payload: { tracks: readTracks(event.payload.trackIds) } } })
    else send({ event })
  }
  let pending = ''
  socket.setEncoding('utf8')
  socket.on('connect', () => send({ event: { type: 'ready', payload: { protocol: DESKTOP_PROTOCOL, instance: process.env.OPENFY_DESKTOP_INSTANCE, port: Number(process.env.NITRO_PORT || 3000) } } }))
  socket.on('error', error => console.error('[desktop] Pipe unavailable:', error.message))
  socket.on('data', chunk => {
    pending += chunk
    if (pending.length > 1024 ** 2) { socket.destroy(); return }
    let split: number
    while ((split = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, split); pending = pending.slice(split + 1)
      void (async () => {
        let request: DesktopRequest
        try { request = JSON.parse(line) } catch { return }
        if (typeof request.id !== 'string') return
        try {
          const params = request.params || {}
          let result: unknown
          switch (request.method) {
            case 'createPairing': result = createPairing(); break
            case 'listSyncDevices': result = listSyncDevices(); break
            case 'revokeSyncDevice': result = revokeSyncDevice(String(params.id || '')); break
            case 'resolveAsset': {
              const asset = getDatabase().select().from(assets).where(eq(assets.id, String(params.id || ''))).get()
              if (!asset) throw new Error('Archivo no disponible.')
              result = { path: join(asset.variant === 'original' ? dataPaths().originals : dataPaths().mobile, asset.filename) }
              break
            }
            case 'importPaths': if (isMaintenance()) throw new Error('Openfy se está actualizando.'); result = await importPaths(params.paths); break
            case 'updateReadiness': result = updateReadiness(String(params.owner), true); break
            case 'beginMaintenance': result = await beginMaintenance(String(params.owner), Number(params.minSchema || 1), Number(params.maxSchema || 6)); break
            case 'cancelMaintenance': cancelMaintenance(); result = { ok: true }; break
            case 'prepareArtwork': result = await prepareArtwork(params.url, params.size); break
            case 'subscribe': desktopEvents.off('change', listener); desktopEvents.on('change', listener); result = { subscribed: true }; break
            case 'shutdown':
              send({ id: request.id, result: { stopping: true } })
              setTimeout(() => process.emit('SIGTERM'), 50)
              return
            default: throw new Error('Comando no compatible.')
          }
          send({ id: request.id, result })
        } catch (error) { send({ id: request.id, error: error instanceof Error ? error.message : 'Falló la operación.' }) }
      })()
    }
  })
  return () => { desktopEvents.off('change', listener); socket.destroy() }
}
