import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { libraryConnection } from '../database'
import { notifyDesktop } from './desktop-events'
import type { SyncAcknowledgement, SyncChange, SyncExchange, SyncFavorite, SyncOperation, SyncPlaylist } from '../../shared/types/sync'
import type { YouTubeSong } from '../../shared/types/music'

export class SyncError extends Error { constructor(message: string, public statusCode = 400) { super(message) } }
type Entity = { revision: number; payload: string | null; deleted: number }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const codes = new Map<string, { expires: number }>()
let attempts = { at: 0, count: 0 }
const portable = (ids: string[]) => [...new Set(ids.filter(id => /^youtube:[A-Za-z0-9_-]{11}$/.test(id)))]

export function applyPortable(existing: string[], incoming: string[]) {
  const next = portable(incoming), last = existing.findLastIndex(id => id.startsWith('youtube:'))
  if (last < 0) return [...existing, ...next]
  let index = 0
  return existing.flatMap((id, at) => {
    const values = id.startsWith('youtube:') ? index < next.length ? [next[index++]!] : [] : [id]
    if (at === last) while (index < next.length) values.push(next[index++]!)
    return values
  })
}
function record(kind: 'favorite' | 'playlist', id: string, value: unknown, device = 'windows', deleted = false) {
  const db = libraryConnection(), payload = deleted ? null : JSON.stringify(value)
  const prior = db.prepare('SELECT revision,payload,deleted FROM sync_entities WHERE kind=? AND entity_id=?').get(kind, id) as Entity | undefined
  if (prior && prior.payload === payload && !!prior.deleted === deleted) return prior.revision
  const revision = (prior?.revision || 0) + 1
  db.prepare(`INSERT INTO sync_entities(kind,entity_id,revision,deleted,payload) VALUES(?,?,?,?,?)
    ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted,payload=excluded.payload`).run(kind, id, revision, +deleted, payload)
  db.prepare('INSERT INTO sync_changes(kind,entity_id,revision,deleted,payload,device_id) VALUES(?,?,?,?,?,?)').run(kind, id, revision, +deleted, payload, device)
  return revision
}
export function captureFavorite(videoId: string, device = 'windows') {
  const db = libraryConnection()
  const row = db.prepare('SELECT song,favorite FROM youtube_songs WHERE video_id=?').get(videoId) as { song: string; favorite: number } | undefined
  if (!row) return 0
  if (!row.favorite && !db.prepare("SELECT 1 FROM sync_entities WHERE kind='favorite' AND entity_id=?").get(`youtube:${videoId}`)) return 0
  return record('favorite', `youtube:${videoId}`, { song: JSON.parse(row.song), favorite: !!row.favorite }, device)
}
export function capturePlaylist(id: string, device = 'windows') {
  const db = libraryConnection()
  if (db.prepare('SELECT 1 FROM sync_local_playlists WHERE id=?').get(id)) return 0
  const row = db.prepare('SELECT name,track_ids FROM playlists WHERE id=?').get(id) as { name: string; track_ids: string } | undefined
  if (!row) return record('playlist', id, null, device, true)
  const trackIds = portable(JSON.parse(row.track_ids))
  const songs = trackIds.map(key => db.prepare('SELECT song FROM youtube_songs WHERE video_id=?').get(key.slice(8)) as { song: string } | undefined)
    .filter((item): item is { song: string } => !!item).map(item => JSON.parse(item.song))
  return record('playlist', id, { name: row.name, trackIds, songs }, device)
}
export function seedSync() {
  const db = libraryConnection()
  db.transaction(() => {
    for (const row of db.prepare('SELECT video_id FROM youtube_songs WHERE favorite=1').all() as { video_id: string }[]) captureFavorite(row.video_id)
    for (const row of db.prepare('SELECT id FROM playlists').all() as { id: string }[]) capturePlaylist(row.id)
  })()
}
export function createPairing(now = Date.now()) {
  const origin = process.env.OPENFY_ORIGIN || ''
  if (!origin || new URL(origin).protocol !== 'https:') throw new SyncError('Configura primero la dirección HTTPS privada de Openfy.')
  for (const [key, value] of codes) if (value.expires <= now) codes.delete(key)
  if(codes.size >= 10) codes.delete(codes.keys().next().value!)
  const code = randomBytes(8).toString('hex').toUpperCase()
  const expiresAt = now + 5 * 60_000
  codes.set(hash(code), { expires: expiresAt })
  seedSync()
  return { code, expiresAt, origin: new URL(origin).origin }
}
export function pairDevice(code: string, deviceId: string, name: string, now = Date.now()) {
  if (now - attempts.at > 60_000) attempts = { at: now, count: 0 }
  if (++attempts.count > 20) throw new SyncError('Espera un minuto antes de volver a intentar vincular.', 429)
  const key = hash(code.replace(/[\s-]/g, '').toUpperCase()), pending = codes.get(key)
  if (!pending || pending.expires <= now) throw new SyncError('El código no es válido o ha caducado.', 401)
  const db = libraryConnection()
  // Do not allow a pairing request to overwrite another installation's credentials or sequence.
  if (db.prepare('SELECT 1 FROM sync_devices WHERE id=?').get(deviceId)) throw new SyncError('Genera una vinculación nueva para este dispositivo.', 409)
  const token = randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO sync_devices(id,name,token_hash,created_at) VALUES(?,?,?,?)').run(deviceId, name, hash(token), now)
  codes.delete(key)
  return { token, deviceId, protocol: 1 }
}
export function authenticateDevice(token: string, deviceId: string) {
  const db = libraryConnection()
  const device = db.prepare('SELECT token_hash,revoked FROM sync_devices WHERE id=?').get(deviceId) as { token_hash: string; revoked: number } | undefined
  if (!device || device.revoked || !timingSafeEqual(Buffer.from(device.token_hash, 'hex'), Buffer.from(hash(token), 'hex'))) throw new SyncError('El dispositivo no está vinculado o su acceso fue revocado.', 401)
}
export function listSyncDevices() {
  return libraryConnection().prepare('SELECT id,name,created_at AS createdAt,last_seen AS lastSeen FROM sync_devices WHERE revoked=0 ORDER BY created_at DESC').all()
}
export function revokeSyncDevice(id: string) { libraryConnection().prepare('UPDATE sync_devices SET revoked=1 WHERE id=?').run(id); return { ok: true } }

function saveSong(song: YouTubeSong) {
  libraryConnection().prepare(`INSERT INTO youtube_songs(video_id,song,favorite,added_at) VALUES(?,?,0,?)
    ON CONFLICT(video_id) DO UPDATE SET song=excluded.song`).run(song.videoId, JSON.stringify(song), Date.now())
}
function preserveLocals(id: string) {
  const db = libraryConnection()
  const row = db.prepare('SELECT name,track_ids FROM playlists WHERE id=?').get(id) as { name: string; track_ids: string } | undefined
  if (!row) return
  const local = (JSON.parse(row.track_ids) as string[]).filter(key => !key.startsWith('youtube:'))
  if (!local.length) return
  const localId = randomUUID()
  db.prepare('INSERT INTO playlists(id,name,track_ids,revision,updated_at) VALUES(?,?,?,1,?)').run(localId, `${row.name} (local)`, JSON.stringify(local), Date.now())
  db.prepare('INSERT INTO sync_local_playlists(id) VALUES(?)').run(localId)
}
function applyOperation(deviceId: string, op: SyncOperation): SyncAcknowledgement {
  const db = libraryConnection()
  const fingerprint = hash(JSON.stringify(op))
  const prior = db.prepare('SELECT fingerprint,acknowledgement FROM sync_operations WHERE device_id=? AND operation_id=?').get(deviceId, op.operationId) as { fingerprint: string; acknowledgement: string } | undefined
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new SyncError('Una operación repetida contiene datos diferentes.', 409)
    return JSON.parse(prior.acknowledgement)
  }
  const device = db.prepare('SELECT last_sequence FROM sync_devices WHERE id=?').get(deviceId) as { last_sequence: number }
  if (op.sequence <= device.last_sequence) throw new SyncError('La secuencia de sincronización no es válida.', 409)
  let revision = 0, conflictId: string | undefined
  if (op.kind === 'favorite') {
    const payload = op.payload as SyncFavorite
    if (op.entityId !== `youtube:${payload.song.videoId}`) throw new SyncError('La identidad de la canción no coincide.')
    saveSong(payload.song)
    db.prepare('UPDATE youtube_songs SET favorite=? WHERE video_id=?').run(+payload.favorite, payload.song.videoId)
    revision = captureFavorite(payload.song.videoId, deviceId)
  } else {
    const entity = db.prepare("SELECT revision,payload,deleted FROM sync_entities WHERE kind='playlist' AND entity_id=?").get(op.entityId) as Entity | undefined
    let id = op.entityId
    if (op.kind === 'deletePlaylist') {
      if (entity && !entity.deleted && op.baseRevision !== entity.revision) {
        // Keep the intervening edit as a new shared collection before acknowledging the offline delete.
        const existing = db.prepare('SELECT name,track_ids FROM playlists WHERE id=?').get(id) as { name:string; track_ids:string } | undefined
        if(existing) {
          conflictId=randomUUID()
          db.prepare('INSERT INTO playlists(id,name,track_ids,revision,updated_at) VALUES(?,?,?,1,?)')
            .run(conflictId,`${existing.name.slice(0,75)} (conflicto Windows)`,existing.track_ids,Date.now())
          capturePlaylist(conflictId,deviceId)
        }
      } else preserveLocals(id)
      db.prepare('DELETE FROM playlists WHERE id=?').run(id)
      revision = record('playlist', id, null, deviceId, true)
    } else {
      const payload = op.payload as SyncPlaylist
      const normalized = { name: payload.name, trackIds: portable(payload.trackIds), songs: payload.songs }
      if (entity && op.baseRevision !== entity.revision && (entity.deleted || entity.payload !== JSON.stringify(normalized))) {
        conflictId = id = randomUUID()
        normalized.name = `${payload.name.slice(0,75)} (conflicto Android)`
      }
      normalized.songs.forEach(saveSong)
      for (const key of normalized.trackIds) if (!db.prepare('SELECT 1 FROM youtube_songs WHERE video_id=?').get(key.slice(8))) throw new SyncError('Faltan los metadatos de una canción de la playlist.')
      const existing = db.prepare('SELECT track_ids FROM playlists WHERE id=?').get(id) as { track_ids: string } | undefined
      const combined = applyPortable(existing ? JSON.parse(existing.track_ids) : [], normalized.trackIds)
      db.prepare(`INSERT INTO playlists(id,name,track_ids,revision,updated_at) VALUES(?,?,?,1,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,track_ids=excluded.track_ids,revision=playlists.revision+1,updated_at=excluded.updated_at`)
        .run(id, normalized.name, JSON.stringify(combined), Date.now())
      const applied = capturePlaylist(id, deviceId)
      revision = conflictId ? entity!.revision : applied
    }
  }
  const ack = { operationId: op.operationId, entityId: op.entityId, revision, ...(conflictId ? { conflictId } : {}) }
  db.prepare('INSERT INTO sync_operations(device_id,operation_id,sequence,fingerprint,acknowledgement) VALUES(?,?,?,?,?)').run(deviceId, op.operationId, op.sequence, fingerprint, JSON.stringify(ack))
  db.prepare('UPDATE sync_devices SET last_sequence=?,last_seen=? WHERE id=?').run(op.sequence, Date.now(), deviceId)
  return ack
}
export function exchangeSync(deviceId: string, token: string, cursor: number, operations: SyncOperation[]): SyncExchange {
  authenticateDevice(token, deviceId)
  seedSync()
  const db = libraryConnection()
  const result = db.transaction(() => {
    const acknowledgements = operations.map(op => applyOperation(deviceId, op))
    const rows = db.prepare('SELECT cursor,kind,entity_id,revision,deleted,payload FROM sync_changes WHERE cursor>? ORDER BY cursor LIMIT 501').all(cursor) as { cursor: number; kind: SyncChange['kind']; entity_id: string; revision: number; deleted: number; payload: string | null }[]
    const hasMore = rows.length > 500
    const changes = rows.slice(0,500).map(row => ({ cursor: row.cursor, kind: row.kind, entityId: row.entity_id, revision: row.revision, deleted: !!row.deleted, payload: row.payload ? JSON.parse(row.payload) : null }))
    return { acknowledgements, changes, cursor: changes.at(-1)?.cursor ?? cursor, hasMore }
  })()
  if(operations.length) notifyDesktop('libraryChanged')
  return result
}
