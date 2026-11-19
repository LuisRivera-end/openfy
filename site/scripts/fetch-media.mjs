import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { access, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { finished } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(join(ROOT, 'package.json'))
const SERVER_ENTRY = join(ROOT, '.output', 'server', 'index.mjs')
const MEDIA_DIR = join(ROOT, 'site', 'src', 'assets', 'media')
const MANIFEST_PATH = join(ROOT, 'site', 'src', 'data', 'media.json')
const REMOVE_TEMP = { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }
const HOST = '127.0.0.1'
const FEATURED_MIN = 4
const FEATURED_LIMIT = 8
const LIBRARY_SIZE = 12

const FEATURED = [
  ['Bad Bunny', 'DeBÍ TiRAR MáS FOToS'],
  ['Bad Bunny', 'Un Verano Sin Ti'],
  ['The Marías', 'Submarine'],
  ['ROSALÍA', 'MOTOMAMI'],
  ['KAROL G', 'MAÑANA SERÁ BONITO'],
  ['Billie Eilish', 'HIT ME HARD AND SOFT'],
  ['Sabrina Carpenter', "Short n' Sweet"],
  ['Peso Pluma', 'GÉNESIS'],
  ['Dua Lipa', 'Radical Optimism'],
  ['Kendrick Lamar', 'GNX'],
  ['Taylor Swift', 'THE TORTURED POETS DEPARTMENT'],
  ['Feid', 'FERXXOCALIPSIS'],
]
const LIBRARY_EXTRAS = [
  ['Shakira', 'Las Mujeres Ya No Lloran'],
  ['Rauw Alejandro', 'Saturno'],
  ['Charli xcx', 'BRAT'],
  ['Chappell Roan', 'The Rise and Fall of a Midwest Princess'],
  ['SZA', 'SOS'],
  ['Tame Impala', 'Currents'],
  ['Olivia Rodrigo', 'GUTS'],
  ['The Weeknd', 'After Hours'],
  ['Natanael Cano', 'NataKong'],
  ['Mon Laferte', 'Autopoiética'],
  ['Fuerza Regida', 'PERO NO TE ENAMORES'],
  ['Arctic Monkeys', 'AM'],
]

const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
const requestTarget = url => `${url.host}${url.pathname}`
const message = error => redact(error instanceof Error ? error.message : String(error))

function redact(text) {
  return text.replace(/https?:\/\/[^\s"'<>`\\]+/gi, value => {
    try { return requestTarget(new URL(value)) } catch { return '[URL omitida]' }
  })
}

async function readCandidates(args) {
  if (!args.length) return { featured: FEATURED, extras: LIBRARY_EXTRAS }
  if (args.length !== 2 || args[0] !== '--candidates') {
    throw new Error('Uso: npm run media -- [--candidates <archivo.json>]')
  }
  const candidates = await readJson(args[1]).catch(() => {
    throw new Error('No se pudo leer el JSON de candidatos.')
  })
  for (const key of ['featured', 'extras']) {
    if (!Array.isArray(candidates?.[key]) || !candidates[key].every(pair =>
      Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string' && value.trim()))) {
      throw new Error(`El campo «${key}» debe contener pares de artista y álbum.`)
    }
  }
  return candidates
}

async function findNode() {
  try {
    const { nodePath } = await readJson(join(ROOT, '.openfy-runtime.json'))
    if (typeof nodePath === 'string' && nodePath.trim()) {
      const path = resolve(ROOT, nodePath)
      await access(path)
      return path
    }
  } catch { /* The desktop runtime is optional. */ }
  return process.execPath
}

function findFfmpeg() {
  if (process.env.OPENFY_FFMPEG) return process.env.OPENFY_FFMPEG
  try { return require('ffmpeg-static') || 'ffmpeg' } catch { return 'ffmpeg' }
}

async function freePort() {
  const reservation = createServer()
  await new Promise((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, HOST, resolve)
  })
  const { port } = reservation.address()
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  return port
}

function watchProcess(child) {
  let failure
  child.on('error', error => { failure = error })
  const closed = new Promise(resolve => {
    child.once('close', (code, signal) => resolve({ code, signal, failure }))
  })
  return { child, closed }
}

const isRunning = child => child.pid && child.exitCode === null && child.signalCode === null

function startBackend(node, port, tempDir, instance, log) {
  const env = {
    ...process.env,
    NITRO_PORT: String(port),
    NITRO_HOST: HOST,
    OPENFY_DATA_DIR: tempDir,
    OPENFY_MOTION_ART: 'on',
    OPENFY_DESKTOP_INSTANCE: instance,
  }
  // Inherited desktop settings can attach the backend to an existing session.
  for (const key of Object.keys(env)) {
    if ([
      'OPENFY_ORIGIN', 'OPENFY_DESKTOP_PIPE', 'OPENFY_SESSION_LOG_DIR', 'OPENFY_STATE_DIR',
      'OPENFY_VERIFY_UPDATE', 'NITRO_UNIX_SOCKET', 'NITRO_SSL_CERT', 'NITRO_SSL_KEY', 'NODE_OPTIONS',
    ].includes(key.toUpperCase())) delete env[key]
  }
  const server = watchProcess(spawn(node, [SERVER_ENTRY], {
    cwd: tempDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  }))
  for (const input of [server.child.stdout, server.child.stderr]) {
    createInterface({ input, crlfDelay: Infinity }).on('line', line => log.write(`${redact(line)}\n`))
  }
  return server
}

async function stopBackend({ child, closed }) {
  if (isRunning(child)) {
    child.kill()
    const ended = await Promise.race([closed.then(() => true), delay(2500, false, { ref: false })])
    if (!ended && isRunning(child) && process.platform === 'win32') {
      const killer = watchProcess(spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore',
      }))
      await killer.closed
    }
    if (!ended && isRunning(child)) child.kill('SIGKILL')
  }
  await closed
}

async function waitForBackend(server, base, instance, signal) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    if (!isRunning(server.child)) {
      const { code, signal, failure } = await server.closed
      throw new Error(`El servidor aislado se cerró durante el arranque (${failure?.code ?? signal ?? code}).`)
    }
    const start = Date.now()
    const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.min(500, Math.max(1, deadline - start)))])
    const status = await fetch(new URL('/api/status', base), { signal: probeSignal, redirect: 'error' })
      .then(async response => {
        if (response.status === 200) return response.json()
        await response.body?.cancel()
      }).catch(() => null)
    signal.throwIfAborted()
    if (status?.online === true) {
      if (status.desktopInstance !== instance) throw new Error('El puerto respondió desde otro servidor de Openfy.')
      return
    }
    await delay(Math.max(0, Math.min(start + 500, deadline) - Date.now()), undefined, { signal })
  }
  throw new Error('El servidor aislado no respondió en 60 segundos.')
}

class HttpError extends Error {
  constructor(url, status) {
    super(`HTTP ${status} en ${requestTarget(url)}`)
    this.status = status
  }
}

async function request(url, signal, { body, binary = false } = {}) {
  const init = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }
  for (const retry of [true, false]) {
    try {
      const response = await fetch(url, {
        ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw new HttpError(url, response.status)
      }
      return binary ? Buffer.from(await response.arrayBuffer()) : await response.json()
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof HttpError && (!retry || error.status < 500)) throw error
      if (error instanceof SyntaxError) throw new Error(`Respuesta JSON no válida en ${requestTarget(url)}`)
      if (!retry) throw new Error(`Error de red en ${requestTarget(url)} (${error.name})`)
      await delay(2000, undefined, { signal })
    }
  }
}

function normalize(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

async function findAlbum(api, [artist, title]) {
  const query = new URLSearchParams({ q: `${artist} ${title}`, type: 'album' })
  const { albums } = await api(`/api/music/search?${query}`)
  const wantedTitle = normalize(title)
  const wantedArtist = normalize(artist)
  const match = albums.find(album => {
    const name = normalize(album.title)
    return (name === wantedTitle || (wantedTitle && name.startsWith(wantedTitle)))
      && album.artists.some(ref => normalize(ref.name) === wantedArtist)
  })
  if (!match) throw new Error('sin coincidencia en YouTube Music')
  return match
}

function artworkUrls(artwork) {
  if (!artwork) throw new Error('sin portada')
  const url = new URL(artwork)
  if (url.protocol !== 'https:') throw new Error('la portada no usa HTTPS')
  if (/(^|\.)(googleusercontent\.com|ggpht\.com)$/.test(url.hostname)) {
    url.pathname = url.pathname.replace(/=w\d+-h\d+(?=-|$)/, '=w1024-h1024').replace(/=s\d+(?=-|$)/, '=s1024')
  }
  const video = /^\/vi(?:_webp)?\/([\w-]{11})\/[\w]+\.(?:jpg|webp)$/.exec(url.pathname)?.[1]
  if (video && /(^|\.)ytimg\.com$/.test(url.hostname)) {
    return ['maxresdefault', 'hqdefault'].map(size => new URL(`https://i.ytimg.com/vi/${video}/${size}.jpg`))
  }
  return [url]
}

async function downloadCover(artwork, signal) {
  const [large, fallback] = artworkUrls(artwork)
  try { return await request(large, signal, { binary: true }) } catch (error) {
    signal.throwIfAborted()
    if (!fallback) throw error
    return request(fallback, signal, { binary: true })
  }
}

const webp = (sharp, input, size, quality) => sharp(input).rotate().resize(size, size, { fit: 'cover' }).webp({ quality }).toBuffer()
const hex = color => `#${color.toString(16).padStart(6, '0')}`

async function coverPalette(sharp, input) {
  const pixels = await sharp(input).rotate().resize(3, 3, { fit: 'cover' })
    .toColourspace('srgb').removeAlpha().raw().toBuffer()
  const grid = Array.from({ length: 9 }, (_, i) => pixels.readUIntBE(3 * i, 3))
  const diagonal = [grid[0], grid[4], grid[8]]
  const colors = []
  for (const pixel of diagonal) {
    let color = pixel
    if (colors.includes(color)) {
      color = grid.find(value => !diagonal.includes(value) && !colors.includes(value)) ?? pixel
      // A solid cover may have no other sampled color. Vary its blue channel slightly.
      for (let bit = 1; diagonal.includes(color) || colors.includes(color); bit++) color = pixel ^ bit
    }
    colors.push(color)
  }
  const { dominant: { r, g, b } } = await sharp(input).stats()
  return { colors: colors.map(hex), dominant: hex(r * 65536 + g * 256 + b) }
}

async function runFfmpeg(ffmpeg, args, signal) {
  signal.throwIfAborted()
  const { child, closed } = watchProcess(spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  }))
  let lastError = ''
  createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', line => { lastError = line })
  const interrupt = () => child.kill()
  signal.addEventListener('abort', interrupt, { once: true })
  try {
    const result = await closed
    signal.throwIfAborted()
    if (result.failure || result.code !== 0) {
      throw new Error(`Falló FFmpeg (${result.failure?.code ?? result.signal ?? result.code})${lastError ? `: ${redact(lastError)}` : ''}`)
    }
  } finally {
    signal.removeEventListener('abort', interrupt)
  }
}

async function transcodeMotion(input, { sharp, ffmpeg, tempDir, signal }) {
  const source = join(tempDir, 'input.mp4')
  const output = join(tempDir, 'motion.mp4')
  const poster = join(tempDir, 'poster.png')
  await writeFile(source, input)
  const encode = (crf, length) => runFfmpeg(ffmpeg, [
    '-y', '-i', source, '-an', '-vf', 'scale=480:480:force_original_aspect_ratio=increase,crop=480:480,fps=30',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-profile:v', 'main',
    '-movflags', '+faststart', '-t', length, output,
  ], signal)
  await encode('28', '12')
  if ((await stat(output)).size > 1_600_000) await encode('32', '8')
  await runFfmpeg(ffmpeg, ['-y', '-ss', '0', '-i', output, '-frames:v', '1', '-update', '1', poster], signal)
  return { video: await readFile(output), poster: await webp(sharp, poster, 480, 80) }
}

const hasWords = line => Boolean(line.words?.length)
const roundTime = time => Math.round(time * 1000) / 1000

function lyricWindow(lines) {
  for (let i = Math.floor(lines.length * 0.3); i <= lines.length - 7; i++) {
    const window = lines.slice(i, i + 7)
    if (window.every(({ text }) => text.trim() && !/^[♪♫.\u2026\s]+$/u.test(text))) return window
  }
  return null
}

function rebaseLines(lines) {
  const start = lines[0].time
  const rebase = time => roundTime(time - start)
  return lines.map(({ time, text, words, end }) => ({
    time: rebase(time), text,
    ...(end === undefined ? {} : { end: rebase(end) }),
    ...(words === undefined ? {} : { words: words.map(word => ({ time: rebase(word.time), text: word.text })) }),
  }))
}

async function findLyrics(detail, album, albumIndex, row, { api, signal }) {
  const statuses = new Set()
  let best = null
  for (const { videoId, title, artists, album: songAlbum, duration, artwork } of detail.songs.slice(0, 4)) {
    try {
      const result = await api('/api/lyrics/resolve', { body: {
        entry: { source: 'youtube', song: { videoId, title, artists, album: songAlbum, duration, artwork } },
        duration: duration ?? undefined,
      } })
      if (result.status !== 'synced') {
        statuses.add(result.status)
        continue
      }
      const nonempty = result.lines.filter(line => line.text.trim())
      const window = nonempty.length >= 12 ? lyricWindow(result.lines) : null
      if (!window) {
        statuses.add('synced sin fragmento')
        continue
      }
      const score = nonempty.filter(hasWords).length / nonempty.length
      if (best && best.score >= score) continue
      const lines = rebaseLines(window)
      const last = lines.at(-1)
      best = { score, excerpt: {
        song: title, artist: artists.join(', ') || album.artist, album: album.title, albumIndex,
        attribution: result.attribution, sourceUrl: result.sourceUrl,
        duration: last.end ?? roundTime(last.time + 3), lines,
      } }
    } catch (error) {
      signal.throwIfAborted()
      statuses.add(message(error))
    }
  }
  row.Letra = best ? (best.excerpt.lines.some(hasWords) ? 'synced (por palabra)' : 'synced')
    : [...statuses].join(', ') || 'sin canciones'
  return best?.excerpt ?? null
}

function saveAsset(assets, bytes, extension) {
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${extension}`
  assets.set(name, bytes)
  return name
}

async function prepareAlbum(candidate, row, context) {
  const { api, signal, sharp, assets } = context
  const match = await findAlbum(api, candidate)
  const detail = await api(`/api/music/albums/${encodeURIComponent(match.id)}`)
  const artists = (detail.artists.length ? detail.artists : match.artists).map(ref => ref.name)
  const image = await downloadCover(detail.artwork ?? match.artwork, signal)
  const large = await webp(sharp, image, 512, 82)
  const small = await webp(sharp, image, 160, 80)
  const palette = await coverPalette(sharp, image)
  row.Motion = 'error'
  const motion = await api('/api/motion/resolve', { body: {
    entry: { source: 'youtube', song: { artists, album: detail.title } },
  } })
  row.Motion = motion.status
  if (motion.status !== 'ready') throw new Error('sin portada animada disponible')
  if (!/^\/api\/motion\/[a-f0-9]{64}\.mp4$/.test(motion.url)) throw new Error('ruta de video no válida')
  const clip = await transcodeMotion(await api(motion.url, { binary: true }), context)
  return { detail, image, album: {
    title: detail.title, artist: artists.join(', '), year: detail.year,
    cover: { large: saveAsset(assets, large, 'webp'), small: saveAsset(assets, small, 'webp') },
    ...palette,
    motion: {
      video: saveAsset(assets, clip.video, 'mp4'), poster: saveAsset(assets, clip.poster, 'webp'),
      width: 480, height: 480, bytes: clip.video.length,
    },
    songs: detail.songs.slice(0, 6).map(({ title, duration }) => ({ title, duration })),
  } }
}

async function libraryEntry(title, artist, image, { sharp, assets }) {
  return { title, artist, cover: saveAsset(assets, await webp(sharp, image, 256, 80), 'webp') }
}

async function collectLibrary(entries, featured, context) {
  const { api, signal } = context
  const library = []
  for (const { candidate, row } of entries) {
    signal.throwIfAborted()
    if (library.length === LIBRARY_SIZE) {
      row.Resultado = 'omitido (límite alcanzado)'
      continue
    }
    try {
      const album = await findAlbum(api, candidate)
      const image = await downloadCover(album.artwork, signal)
      library.push(await libraryEntry(album.title, album.artists.map(ref => ref.name).join(', '), image, context))
      row.Resultado = 'aceptado'
    } catch (error) {
      signal.throwIfAborted()
      row.Resultado = `omitido (${message(error)})`
    }
  }
  const fallback = []
  for (let i = 0; library.length < LIBRARY_SIZE; i++) {
    signal.throwIfAborted()
    if (i < featured.length) {
      const { album, image } = featured[i]
      fallback.push(await libraryEntry(album.title, album.artist, image, context))
    }
    library.push(fallback[i % featured.length])
  }
  return library
}

async function collectFeatured(entries, context) {
  const { signal } = context
  const featured = []
  let lyrics = null
  for (const { candidate, row } of entries) {
    signal.throwIfAborted()
    if (featured.length === FEATURED_LIMIT) {
      row.Resultado = 'omitido (límite alcanzado)'
      continue
    }
    let result
    try { result = await prepareAlbum(candidate, row, context) } catch (error) {
      signal.throwIfAborted()
      row.Resultado = `omitido (${message(error)})`
      continue
    }
    const albumIndex = featured.length
    featured.push(result)
    row.Resultado = 'aceptado'
    if (!lyrics) lyrics = await findLyrics(result.detail, result.album, albumIndex, row, context)
  }
  return { featured, lyrics }
}

async function publish(manifest, assets, signal) {
  signal.throwIfAborted()
  await mkdir(dirname(MEDIA_DIR), { recursive: true })
  // Serialize publication and stage on the same volume as the final files.
  const stage = join(dirname(MEDIA_DIR), '.media-publish')
  await mkdir(stage).catch(error => {
    if (error.code === 'EEXIST') throw new Error(`El directorio de publicación está ocupado (${stage}).`)
    throw error
  })
  const retired = join(stage, 'retired')
  const moved = []
  let preserveStage = false
  try {
    for (const [name, bytes] of assets) {
      signal.throwIfAborted()
      await writeFile(join(stage, name), bytes)
    }
    const draft = join(stage, 'media.json')
    await writeFile(draft, `${JSON.stringify(manifest, null, 2)}\n`)
    await mkdir(retired)
    await mkdir(MEDIA_DIR, { recursive: true })
    await mkdir(dirname(MANIFEST_PATH), { recursive: true })
    // Move stale files out before installing the new media. Restore them if publication fails.
    for (const file of await readdir(MEDIA_DIR, { withFileTypes: true })) {
      signal.throwIfAborted()
      if (assets.has(file.name) || !(file.isFile() || file.isSymbolicLink())) continue
      await rename(join(MEDIA_DIR, file.name), join(retired, file.name))
      moved.push(file.name)
    }
    for (const name of assets.keys()) {
      signal.throwIfAborted()
      await rename(join(stage, name), join(MEDIA_DIR, name))
    }
    signal.throwIfAborted()
    await rename(draft, MANIFEST_PATH)
  } catch (error) {
    const restored = await Promise.allSettled(moved.map(name => rename(join(retired, name), join(MEDIA_DIR, name))))
    preserveStage = restored.some(result => result.status === 'rejected')
    if (preserveStage) console.error(`No se pudieron restaurar todas las portadas anteriores. Copia en ${retired}`)
    throw error
  } finally {
    if (!preserveStage) await rm(stage, REMOVE_TEMP)
  }
}

function candidateRows(candidates, group) {
  return candidates.map(candidate => ({ candidate, row: {
    Lista: group, Artista: redact(candidate[0]), Álbum: redact(candidate[1]), Resultado: 'pendiente', Motion: '—', Letra: '—',
  } }))
}

async function main(signal) {
  if (!(await stat(SERVER_ENTRY).catch(() => null))?.isFile()) {
    throw new Error('Ejecuta `npm run build` en la raíz primero')
  }
  const candidates = await readCandidates(process.argv.slice(2))
  const featuredRows = candidateRows(candidates.featured, 'Destacados')
  const extraRows = candidateRows(candidates.extras, 'Biblioteca')
  const node = await findNode()
  const sharp = require('sharp')
  const ffmpeg = findFfmpeg()
  const port = await freePort()
  const base = new URL(`http://${HOST}:${port}`)
  const instance = randomUUID()
  const tempDir = await mkdtemp(join(tmpdir(), 'openfy-site-media-'))
  const logPath = join(tempDir, 'backend.log')
  let log, logDone, server, manifest
  const assets = new Map()
  try {
    signal.throwIfAborted()
    log = (await open(logPath, 'w')).createWriteStream()
    logDone = finished(log).catch(() => {})
    server = startBackend(node, port, tempDir, instance, log)
    await waitForBackend(server, base, instance, signal)
    const api = (path, options) => request(new URL(path, base), signal, options)
    const context = { api, sharp, ffmpeg, tempDir, signal, assets }
    const { featured, lyrics } = await collectFeatured(featuredRows, context)
    if (featured.length < FEATURED_MIN) {
      throw new Error(`Se aceptaron ${featured.length} álbumes destacados. Se necesitan al menos ${FEATURED_MIN}.`)
    }
    const library = await collectLibrary(extraRows, featured, context)
    manifest = { generatedAt: new Date().toISOString(), albums: featured.map(entry => entry.album), lyrics, library }
    await publish(manifest, assets, signal)
  } catch (error) {
    console.error(`Registro temporal del servidor en ${logPath}`)
    throw error
  } finally {
    try {
      if (server) await stopBackend(server)
    } finally {
      log?.end()
      await logDone
      await rm(tempDir, REMOVE_TEMP).catch(() => {})
      console.table([...featuredRows, ...extraRows].map(entry => entry.row))
    }
  }
  const bytes = [...assets.values()].reduce((sum, buffer) => sum + buffer.length, 0)
  console.log(`${bytes.toLocaleString('es-MX')} bytes en site/src/assets/media`)
  console.log(manifest.lyrics
    ? `Letra de «${redact(manifest.lyrics.song)}» — ${redact(manifest.lyrics.artist)}`
    : 'No se encontró un fragmento de letra sincronizada.')
}

const controller = new AbortController()
const interrupt = () => controller.abort(new Error('Operación interrumpida.'))
process.on('SIGINT', interrupt)
try {
  await main(controller.signal)
} catch (error) {
  console.error(message(controller.signal.aborted ? controller.signal.reason : error))
  process.exitCode = controller.signal.aborted ? 130 : 1
} finally {
  process.off('SIGINT', interrupt)
}
