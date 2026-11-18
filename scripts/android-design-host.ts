/**
 * Design QA host for the Android app. Serves the real sync protocol over loopback from a COPY of a
 * library, so the debug app shows real favourites, playlists, covers and listening history.
 *
 * The source library is opened read-only once, through SQLite's online backup API; nothing is ever
 * written to it. The host refuses to use the personal data directory as its working copy.
 *
 * Usage (bundle first, like the other TypeScript fixtures):
 *   node <bundle> [sourceDataDir] [copyDataDir] [port]
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'

const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase()
const personal = resolve(process.env.LOCALAPPDATA || tmpdir(), 'Openfy', 'data')
const source = resolve(process.argv[2] || process.env.OPENFY_DATA_DIR || personal)
const root = resolve(process.argv[3] || join(tmpdir(), 'Openfy', 'design-qa', 'data'))
const port = Number(process.argv[4] || 4180)
if (same(root, personal) || same(root, source)) throw new Error('The design copy must not be the source or the personal library.')

mkdirSync(root, { recursive: true })
const copy = join(root, 'openfy.sqlite')
if (!existsSync(copy)) {
  const origin = new Database(join(source, 'openfy.sqlite'), { readonly: true, fileMustExist: true })
  try { await origin.backup(copy) } finally { origin.close() }
}

// Server modules resolve the data directory lazily; set it before loading them.
process.env.OPENFY_DATA_DIR = root
process.env.OPENFY_ORIGIN = 'https://openfy.test.ts.net'
process.env.OPENFY_MOTION_ART = 'off'
const { createPairing, pairDevice, exchangeSync, SyncError } = await import('../server/utils/device-sync')
const { libraryConnection } = await import('../server/database')
const db = libraryConnection()

type ListeningDay = { track_key: string; day: string; listened_ms: number; plays: number; last_played_at: number; song: string | null }

/** Real listening history of YouTube songs, with the metadata Android needs to show them. */
function listening() {
  const rows = db.prepare(`SELECT d.track_key, d.day, d.listened_ms, d.plays, d.last_played_at, s.song
    FROM listening_days d LEFT JOIN youtube_songs s ON s.video_id = substr(d.track_key, 9)
    WHERE d.track_key LIKE 'youtube:%' AND (d.listened_ms > 0 OR d.plays > 0)`).all() as ListeningDay[]
  return rows.filter(row => row.song).map(row => ({
    songId: row.track_key, day: row.day, listenedMs: row.listened_ms, plays: row.plays,
    lastPlayedAt: row.last_played_at, song: JSON.parse(row.song!)
  }))
}

function counts() {
  const one = (sql: string) => (db.prepare(sql).get() as { count: number }).count
  return {
    songs: one('SELECT COUNT(*) AS count FROM youtube_songs'),
    favorites: one('SELECT COUNT(*) AS count FROM youtube_songs WHERE favorite = 1'),
    playlists: one('SELECT COUNT(*) AS count FROM playlists'),
    listeningDays: one('SELECT COUNT(*) AS count FROM listening_days')
  }
}

const server = createServer(async (req, res) => {
  try {
    const raw: Buffer[] = []; let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new SyncError('Body too large', 413); raw.push(chunk) }
    const body = raw.length ? JSON.parse(Buffer.concat(raw).toString()) : {}
    let response: unknown
    switch (req.url) {
      case '/design/pairing': response = createPairing(); break
      case '/design/listening': response = { items: listening() }; break
      case '/design/state': response = counts(); break
      case '/api/sync/v1/pair': response = pairDevice(body.code, body.deviceId, body.name); break
      case '/api/sync/v1/exchange':
        response = exchangeSync(body.deviceId, String(req.headers.authorization || '').replace(/^Bearer /, ''), body.cursor, body.operations)
        break
      default: res.writeHead(404).end(); return
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response))
  } catch (error) {
    const status = error instanceof SyncError ? error.statusCode : 500
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ message: error instanceof Error ? error.message : 'error' }))
  }
})
server.listen(port, '127.0.0.1', () => console.log(`design host ready http://127.0.0.1:${port} ${JSON.stringify(counts())}`))
