// Real provider acceptance check. Uses its own library and never restarts the user's app.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { parseFile } from 'music-metadata'

const entry = resolve(process.argv[2] || '.output/server/index.mjs')
const reportPath = resolve(process.argv[3] || 'output/downloads-check/real.json')
const root = await mkdtemp(join(tmpdir(), 'openfy-real-downloads-'))
await mkdir(join(root, 'session-logs'))
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const base = `http://127.0.0.1:${port}`
let child, errors = ''
async function start() {
  child = spawn(process.execPath, [entry], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env,
    OPENFY_DATA_DIR: root, OPENFY_SESSION_LOG_DIR: join(root, 'session-logs'), OPENFY_SESSION_ID: 'download-check',
    NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port) } })
  child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-8000) })
  const until = Date.now() + 30000
  for (;;) {
    try { if ((await fetch(base + '/api/status')).ok) return } catch {}
    if (child.exitCode !== null || Date.now() > until) throw Error('Backend failed to start: ' + errors)
    await delay(100)
  }
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill(); await exited
}
async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${await response.text()}`)
  return response.json()
}
async function ready(videoId) {
  const until = Date.now() + 150000
  for (;;) {
    const job = (await api('/api/music/downloads')).find(job => job.videoId === videoId)
    if (job?.state === 'ready') return job
    if (job?.state === 'failed' || Date.now() > until) throw Error('Download failed: ' + JSON.stringify(job))
    await delay(500)
  }
}
try {
  await start()
  const first = (await api('/api/music/search?q=' + encodeURIComponent('Cheel Blue Dream'))).songs[0]
  const second = (await api('/api/music/search?q=' + encodeURIComponent('Vibe Tracks Crystal'))).songs.find(song => song.videoId !== first.videoId)
  if (!first || !second) throw Error('Missing real catalog samples')
  await api('/api/music/saved', 'PUT', { song: first, favorite: true })
  await api('/api/music/downloads', 'POST', { songs: [first, first], intent: 'manual' })
  const job = await ready(first.videoId)
  let library = await api('/api/library')
  const saved = library.youtubeSongs.find(saved => saved.song.videoId === first.videoId)
  if (!saved.favorite || !saved.localAudio || library.tracks.length) throw Error('Song identity or favorite changed')
  const file = join(root, 'originals', saved.localAudio.asset.id + '.m4a')
  const hash = createHash('sha256').update(await readFile(file)).digest('hex')
  if (hash !== saved.localAudio.asset.hash) throw Error('Stored audio hash mismatch')
  const metadata = await parseFile(file, { duration: true })
  let playlist = await api('/api/playlists', 'POST', { name: 'Real offline check' })
  playlist = await api(`/api/playlists/${playlist.id}`, 'PUT', { ...playlist, trackIds: [`youtube:${first.videoId}`] })
  await api(`/api/offline/collections/playlist/${playlist.id}`, 'PUT', { enabled: true })
  await api('/api/music/saved', 'PUT', { song: second })
  playlist = await api(`/api/playlists/${playlist.id}`, 'PUT', { ...playlist, trackIds: [...playlist.trackIds, `youtube:${second.videoId}`] })
  await ready(second.videoId)
  await api(`/api/playlists/${playlist.id}`, 'PUT', { ...playlist, trackIds: [`youtube:${second.videoId}`] })
  if (!(await api('/api/library')).youtubeSongs.find(saved => saved.song.videoId === first.videoId)?.localAudio) throw Error('Removing a playlist member deleted its audio')
  await stop(); await start()
  library = await api('/api/library')
  const jobs = await api('/api/music/downloads')
  const report = { passed: jobs.length === 2 && jobs.every(job => job.state === 'ready'), root,
    sample: { videoId: first.videoId, title: first.title, file, bytes: job.bytes, duration: metadata.format.duration, hash },
    automaticPlaylist: true, retainedRemovedSong: true, restoredAfterRestart: library.youtubeSongs.every(saved => saved.localAudio),
    canonicalKeys: library.youtubeSongs.map(saved => `youtube:${saved.song.videoId}`) }
  if (!report.passed || !report.restoredAfterRestart) throw Error('Recovery failed')
  await mkdir(resolve(reportPath, '..'), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await stop() }
