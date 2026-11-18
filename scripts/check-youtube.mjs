// Read-only smoke check against a running Openfy server. No songs are saved.
const base = process.argv[2] || `http://127.0.0.1:${process.env.NITRO_PORT || 3000}`
const query = process.argv[3] || 'Daft Punk Get Lucky'
const artistQuery = process.argv[4] || 'Daft Punk'
async function catalog(path) {
  const result = await fetch(new URL(path, base), { signal: AbortSignal.timeout(25000) })
  if (!result.ok) throw new Error(`Catálogo: HTTP ${result.status} en ${path.split('?')[0]}.`)
  return result.json()
}
try {
  const found = await catalog(`/api/music/search?type=artist&q=${encodeURIComponent(artistQuery)}`)
  if (!found.artists?.length) throw new Error('La búsqueda no devolvió artistas.')
  console.log(`Artistas: ${found.artists.length} para «${artistQuery}».`)
  const artist = await catalog(`/api/music/artists/${found.artists[0].id}`)
  console.log(`Perfil de «${artist.name}»: ${artist.topSongs.length} canciones destacadas, ${artist.albums.length} álbumes y ${artist.singles.length} singles/EPs iniciales.`)
  if (artist.expandable.songs) {
    const first = await catalog(`/api/music/artists/${artist.id}/songs`)
    const more = first.nextCursor ? await catalog(`/api/music/artists/${artist.id}/songs?cursor=${encodeURIComponent(first.nextCursor)}`) : { songs: [] }
    if (new Set([...first.songs, ...more.songs].map(song => song.videoId)).size !== first.songs.length + more.songs.length) throw new Error('Canciones duplicadas en la continuación del artista.')
    console.log(`Canciones del artista: ${first.songs.length} iniciales y ${more.songs.length} adicionales.`)
  }
  let releases = artist.albums
  if (artist.expandable.albums) {
    const result = await catalog(`/api/music/artists/${artist.id}/releases?kind=albums`)
    releases = result.albums
    console.log(`Discografía ampliada: ${releases.length} álbumes en la primera carga.`)
  }
  if (artist.expandable.singles) {
    const result = await catalog(`/api/music/artists/${artist.id}/releases?kind=singles`)
    console.log(`Singles/EPs ampliados: ${result.albums.length} en la primera carga.`)
  }
  if (releases[0]) {
    const album = await catalog(`/api/music/albums/${releases[0].id}`)
    if (!album.songs.length || album.songs.some(song => song.albumId !== album.id || !song.artists.length)) throw new Error('Faltan pistas o metadatos del álbum.')
    console.log(`Álbum «${album.title}»: ${album.songs.length} pistas con artista y referencia al álbum.`)
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
const response = await fetch(new URL(`/api/music/search?q=${encodeURIComponent(query)}`, base), { signal: AbortSignal.timeout(25000) })
if (!response.ok) {
  console.error(`Búsqueda: HTTP ${response.status}.`, (await response.json()).message || '')
  process.exitCode = 1
} else {
  const { songs } = await response.json()
  console.log(`Búsqueda real: ${songs.length} canciones para «${query}».`)
  let playable = false
  for (const song of songs.slice(0, 3)) {
    const url = new URL(`/api/music/youtube/${song.videoId}/stream`, base)
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(45000) })
    console.log(`Audio de «${song.title}»: HEAD ${head.status}.`)
    if (!head.ok) continue
    const range = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(45000) })
    if (range.status !== 206 || range.headers.get('cache-control') !== 'no-store') {
      await range.body?.cancel()
      console.log(`Rango de audio: HTTP ${range.status}.`)
      continue
    }
    const bytes = (await range.arrayBuffer()).byteLength
    console.log(`Rango de audio: HTTP 206, ${bytes} bytes, sin caché.`)
    playable = bytes === 1024
    const length = Number(head.headers.get('content-length'))
    if (playable && length > 2048) {
      const start = Math.floor(length / 2)
      const later = await fetch(url, { headers: { Range: `bytes=${start}-${start + 1023}` }, signal: AbortSignal.timeout(45000) })
      const laterBytes = later.ok ? (await later.arrayBuffer()).byteLength : 0
      if (!later.ok) await later.body?.cancel()
      console.log(`Rango a mitad de canción: HTTP ${later.status}, ${laterBytes} bytes.`)
      playable = later.status === 206 && laterBytes === 1024
    }
    if (playable) break
  }
  if (!playable) {
    console.error('La búsqueda responde, pero YouTube no ofreció audio reproducible en esta comprobación.')
    process.exitCode = 1
  }
}
