import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, statfsSync, statSync } from 'node:fs'
import { dataPaths, getDatabase, librarySchema } from '../database'
import { workerBusy, stopWorkers, startWorkers } from './workers'

interface Client { ack?: string; updated: number; playing: boolean; ready?: boolean }
const clients = new Map<string, Client>()
const CLIENT_TIMEOUT = 90_000
function sweepClients(now = Date.now()) {
  for (const [id, client] of clients) {
    if (now - client.updated > CLIENT_TIMEOUT) clients.delete(id)
  }
}
let operations = 0, frozen = process.env.OPENFY_VERIFY_UPDATE === '1', transaction: string | undefined
let challenge: { id: string; checked: number } | undefined
export function reportClient(id: string, playing: boolean, ready?: boolean, closed = false, ack?: string) {
  sweepClients()
  if (closed) { clients.delete(id); return }
  clients.set(id, { playing, updated: Date.now(), ready, ack })
}
export function updateChallenge() { return challenge?.id }
export function updateReadiness(owner?: string, confirm = false) {
  sweepClients()
  const others = [...clients].filter(([id]) => id !== owner).map(([, client]) => client)
  if (confirm && others.length && (!challenge || Date.now() - challenge.checked > 45_000)) challenge = { id: randomUUID(), checked: Date.now() }
  if (confirm && challenge) challenge.checked = Date.now()
  const busy = others.some(client => client.playing || client.ready === false)
  const unknown = others.some(client => client.ready === undefined || Date.now() - client.updated > 25_000 || confirm && client.ack !== challenge?.id)
  return { maintenance: frozen, ready: !frozen && !busy && !unknown && !workerBusy() && !operations,
    reason: frozen ? 'Preparando la actualización' : busy ? 'Otro dispositivo está en uso' : unknown ? 'Esperando confirmación de un dispositivo' : operations || workerBusy() ? 'La biblioteca tiene operaciones activas' : '' }
}
export function countOperation() { operations++; let ended = false; return () => { if (!ended) { ended = true; operations-- } } }
export function isMaintenance() { return frozen }
export async function beginMaintenance(owner: string, minSchema = 1, maxSchema = 6) {
  const state = updateReadiness(owner, true)
  if (!state.ready) throw new Error(state.reason)
  const dataRoot = dataPaths().root
  if (!existsSync(join(dataRoot, 'openfy.sqlite'))) throw new Error('No se encontró la biblioteca activa.')
  const schema = librarySchema()
  if (schema < minSchema || schema > maxSchema) throw new Error('La biblioteca no es compatible con este paquete.')
  const disk = statfsSync(dataRoot)
  if (disk.bavail * disk.bsize < statSync(join(dataRoot, 'openfy.sqlite')).size * 2 + 16 * 1024 ** 2) throw new Error('No hay espacio para respaldar la biblioteca.')
  frozen = true; transaction = randomUUID()
  try { await stopWorkers(); getDatabase(); return { transaction, dataRoot } }
  catch (error) { cancelMaintenance(); throw error }
}
export function cancelMaintenance() { challenge = undefined; transaction = undefined; frozen = false; startWorkers() }
export async function acknowledgeClose() {
  if (!transaction || !process.env.OPENFY_STATE_DIR) return
  const root = join(resolve(process.env.OPENFY_STATE_DIR), 'update-receipts')
  await mkdir(root, { recursive: true }); await writeFile(join(root, transaction + '.json'), JSON.stringify({ closed: true, transaction }), { flag: 'wx' })
}
