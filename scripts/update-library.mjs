// Used exclusively by the local installer with the backend closed. The update
// never opens a missing database in create mode, even during a rollback.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const [mode, dataRoot, backupRoot, backend] = process.argv.slice(2)
if (!['snapshot', 'verify'].includes(mode) || !dataRoot || !backupRoot || !backend) throw new Error('Argumentos de verificación incompletos.')
const require = createRequire(join(resolve(backend), '.output/server/index.mjs'))
const Database = require('better-sqlite3')
const db = new Database(join(resolve(dataRoot), 'openfy.sqlite'), { readonly: true, fileMustExist: true })
try {
  if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('SQLite no pasó la comprobación de integridad.')
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name))
  if (!tables.has('tracks') || !tables.has('playlists')) throw new Error('La biblioteca no se reconoce.')
  const tracks = db.prepare('SELECT id, hash, metadata, original_id, mobile_id, favorite FROM tracks ORDER BY id').all()
  const songs = tables.has('youtube_songs') ? db.prepare('SELECT video_id, song, favorite, added_at FROM youtube_songs ORDER BY video_id').all() : []
  const playlists = db.prepare('SELECT id, name, revision, track_ids FROM playlists ORDER BY id').all().map(row => ({ ...row, track_ids: JSON.parse(row.track_ids) }))
  const assets = db.prepare('SELECT id, filename, mime, variant, bytes, hash FROM assets ORDER BY id').all()
  const audio = tables.has('youtube_audio') ? db.prepare('SELECT * FROM youtube_audio ORDER BY video_id').all() : []
  const downloads = tables.has('audio_downloads') ? db.prepare('SELECT * FROM audio_downloads ORDER BY id').all() : []
  const offline = tables.has('offline_collections') ? db.prepare('SELECT * FROM offline_collections ORDER BY key').all() : []
  const digest = createHash('sha256').update(JSON.stringify({ tracks, songs, playlists, assets, audio, downloads, offline })).digest('hex')
  const manifestPath = join(backupRoot, 'collection.json')
  if (mode === 'snapshot') {
    await mkdir(backupRoot, { recursive: true })
    await db.backup(join(backupRoot, 'openfy.sqlite'))
    const copy = new Database(join(backupRoot, 'openfy.sqlite'), { readonly: true, fileMustExist: true })
    try { if (copy.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Respaldo de SQLite no válido.') } finally { copy.close() }
    await writeFile(manifestPath, JSON.stringify({ root: resolve(dataRoot), digest, schema: db.pragma('user_version', { simple: true }), favorites: [...tracks, ...songs].filter(row => row.favorite).length, playlists: playlists.map(row => ({ id: row.id, name: row.name, count: row.track_ids.length, revision: row.revision })) }, null, 2), { flag: 'wx' })
  } else {
    const previous = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (previous.root !== resolve(dataRoot) || previous.digest !== digest) throw new Error('La identidad o el contenido de la colección cambió durante la actualización.')
  }
} finally { db.close() }
