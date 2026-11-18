import { openSync, readFileSync, writeFileSync, closeSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

let owned: { path: string; token: string } | undefined
export function acquireLibraryLock(root: string) {
  if (owned) throw new Error('This process already owns an Openfy library')
  const path = join(root, '.openfy-library.lock')
  const token = randomUUID()
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = openSync(path, 'wx')
      try { writeFileSync(handle, JSON.stringify({ pid: process.pid, token, startedAt: Date.now() })) } finally { closeSync(handle) }
      owned = { path, token }
      return
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error
      let previous: { pid: number }
      try { previous = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('Openfy library lock is invalid; inspect it before restarting') }
      try { process.kill(previous.pid, 0); throw new Error('Esta biblioteca ya está abierta por otro servidor de Openfy.') }
      catch (failure: any) {
        if (failure.code !== 'ESRCH') throw failure
        unlinkSync(path)
      }
    }
  }
  throw new Error('No se pudo bloquear la biblioteca de Openfy.')
}
export function releaseLibraryLock() {
  if (!owned) return
  try { if (JSON.parse(readFileSync(owned.path, 'utf8')).token === owned.token) unlinkSync(owned.path) } catch { /* Already released. */ }
  owned = undefined
}
process.once('exit', releaseLibraryLock)
