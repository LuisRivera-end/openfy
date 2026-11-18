// Test-only HTTP front door. WebKit's native media stack bypasses Playwright
// routing, so synthetic YouTube audio must be served over a real socket.
import { createServer, request as forwardRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
const entry = resolve(process.env.OPENFY_TEST_SERVER || '.output/server/index.mjs')
let workerRevision = 0

const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const upstreamPort = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const child = spawn(process.execPath, [process.env.OPENFY_TEST_SERVER || '.output/server/index.mjs'], {
  env: { ...process.env, NITRO_PORT: String(upstreamPort) }, stdio: 'inherit', windowsHide: true,
})
let audio = Buffer.alloc(0)
let audioStatus = 200
let requests = 0
const downloadFixtures = new Map(), downloadIntents = []
const unavailableAssets = new Set(), playbackRequests = []
const searchFixtures = new Map()
const fixturePaths = new Set(['/api/music/youtube/abcdefghijk/stream', '/api/music/youtube/12345678901/stream', '/api/music/youtube/Te1emetry01/stream', '/api/music/youtube/RecentCtx01/stream', '/api/music/youtube/saved000000/stream'])
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  let bufferedBody
  if (url.pathname === '/__test/local-playback') {
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const { assetId, available = true } = JSON.parse(Buffer.concat(chunks).toString())
      if (assetId) { if (available) unavailableAssets.delete(assetId); else unavailableAssets.add(assetId) }
      playbackRequests.length = 0
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(playbackRequests)); return
  }
  if (/^\/api\/music\/youtube\/[^/]+\/stream$/.test(url.pathname)) playbackRequests.push(url.pathname)
  if (unavailableAssets.has(url.pathname.replace('/api/assets/', ''))) { res.statusCode = 404; res.end(); return }
  if (url.pathname === '/__test/music-search' && req.method === 'POST') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const { query, songs } = JSON.parse(Buffer.concat(chunks).toString())
    searchFixtures.set(query, songs); res.end('{"ok":true}'); return
  }
  if (url.pathname === '/api/music/search' && searchFixtures.has(url.searchParams.get('q'))) {
    const type = url.searchParams.get('type')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(type === 'artist' ? { artists: [] } : type === 'album' ? { albums: [] } : { songs: searchFixtures.get(url.searchParams.get('q')) })); return
  }
  if (url.pathname === '/__test/download-requests') {
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const job = JSON.parse(Buffer.concat(chunks).toString())
      downloadFixtures.set(job.videoId, job); downloadIntents.length = 0
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ intents: downloadIntents })); return
  }
  if (url.pathname === '/api/music/downloads' && req.method === 'POST' && downloadFixtures.size) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    bufferedBody = Buffer.concat(chunks)
    const body = JSON.parse(bufferedBody.toString())
    if (body.songs.every(song => downloadFixtures.has(song.videoId))) {
      downloadIntents.push(body.intent)
      res.statusCode = 202; res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body.songs.map(song => downloadFixtures.get(song.videoId)))); return
    }
  }
  if (url.pathname === '/__test/youtube-local' && req.method === 'POST') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const { videoId, assetId, duration, artwork = null, lyrics } = JSON.parse(Buffer.concat(chunks).toString())
    const db = new Database(resolve(process.env.OPENFY_DATA_DIR, 'openfy.sqlite'))
    try {
      if (!db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId)) throw Error('Unknown fixture asset')
      db.prepare('INSERT OR REPLACE INTO youtube_audio(video_id,asset_id,duration,artwork,palette,downloaded_at) VALUES(?,?,?,?,?,?)')
        .run(videoId, assetId, duration, artwork, JSON.stringify(['#111111','#222222','#333333']), Date.now())
      if (lyrics) db.prepare('INSERT OR REPLACE INTO lyrics(key,result) VALUES(?,?)').run(`youtube:${videoId}`, JSON.stringify(lyrics))
      res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}')
    } finally { db.close() }
    return
  }
  if (url.pathname === '/__test/update' && req.method === 'POST') {
    workerRevision++; res.end('ok'); return
  }
  if (url.pathname === '/sw.js' && workerRevision > 0) {
    res.setHeader('Content-Type','text/javascript'); res.setHeader('Cache-Control','no-store')
    res.end(await readFile(resolve(dirname(entry), '../public/sw.js'), 'utf8') + '\n// QA revision ' + workerRevision); return
  }
  if (url.pathname === '/__test/youtube-audio') {
    if (url.searchParams.has('videoId')) fixturePaths.add(`/api/music/youtube/${url.searchParams.get('videoId')}/stream`)
    if (req.method === 'POST') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      audio = Buffer.concat(chunks)
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      audioStatus = Number(url.searchParams.get('status')) || 200
      requests = 0
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ requests, bytes: audio.length }))
    return
  }
  if (fixturePaths.has(url.pathname) && ['GET', 'HEAD'].includes(req.method)) {
    requests++
    res.setHeader('Cache-Control', 'no-store')
    if (audioStatus !== 200) { res.statusCode = audioStatus; res.end(); return }
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = Number(range?.[1] || 0)
    const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1
    res.setHeader('Content-Type', 'audio/mp4')
    res.setHeader('Accept-Ranges', 'bytes')
    if (start > end || start >= audio.length) {
      res.statusCode = 416; res.setHeader('Content-Range', `bytes */${audio.length}`); res.end(); return
    }
    res.statusCode = range ? 206 : 200
    if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${audio.length}`)
    res.setHeader('Content-Length', end - start + 1)
    res.end(req.method === 'HEAD' ? undefined : audio.subarray(start, end + 1))
    return
  }
  const upstream = forwardRequest({ hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers)
    response.pipe(res)
  })
  upstream.on('error', () => { if (!res.headersSent) res.statusCode = 503; res.end() })
  res.on('close', () => upstream.destroy())
  if (bufferedBody) upstream.end(bufferedBody)
  else req.pipe(upstream)
})
server.listen(Number(process.env.NITRO_PORT || 4175), '127.0.0.1')
function stop() { child.kill(); server.close(); server.closeAllConnections() }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
process.on('exit', () => child.kill())
child.on('exit', code => { server.close(); server.closeAllConnections(); process.exitCode = code || 0 })
