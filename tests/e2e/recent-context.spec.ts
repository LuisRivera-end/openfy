import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAudio } from '../helpers/audio'
import type { PlaybackSnapshotV3, YouTubeSong } from '../../shared/types/music'
import type { RecentListening } from '../../shared/types/telemetry'
import { addToQueue } from '../helpers/ui'

test.use({ serviceWorkers: 'block' })
const song: YouTubeSong = { videoId: 'RecentCtx01', title: 'Origen verificable', artists: ['Contexto Openfy'], album: 'Álbum de contexto', albumId: 'MPRE_context', artwork: null, duration: 30 }
let directory: string, playlistId: string
test.beforeAll(async ({ request }) => {
  directory = await mkdtemp(join(tmpdir(), 'openfy-recent-context-'))
  const audio = join(directory, 'context.m4a'); generateAudio(audio, { duration: 30, format: 'aac', frequency: 331 })
  expect((await request.post('/__test/youtube-audio', { data: await readFile(audio) })).ok()).toBe(true)
  expect((await request.put('/api/music/saved', { data: { song, favorite: true } })).ok()).toBe(true)
  const playlist = await (await request.post('/api/playlists', { data: { name: 'Origen de playlist' } })).json()
  playlistId = playlist.id
  expect((await request.put(`/api/playlists/${playlist.id}`, { data: { ...playlist, trackIds: [`youtube:${song.videoId}`] } })).ok()).toBe(true)
})
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

async function snapshot(page: Page) {
  return page.evaluate(() => new Promise<PlaybackSnapshotV3>((resolve, reject) => {
    const open = indexedDB.open('openfy'); open.onerror = () => reject(open.error)
    open.onsuccess = () => { const db = open.result, get = db.transaction('snapshots').objectStore('snapshots').get('playback'); get.onsuccess = () => { resolve(get.result?.value); db.close() }; get.onerror = () => reject(get.error) }
  }))
}
async function recent(request: APIRequestContext) { return (await (await request.get('/api/telemetry/recent?limit=24')).json()) as RecentListening }
async function mockCatalog(page: Page) {
  await page.route('**/api/music/recommendations**', route => route.fulfill({ json: { songs: [], generatedAt: 0, stale: false, error: null } }))
  await page.route('**/api/music/search**', route => {
    const type = new URL(route.request().url()).searchParams.get('type')
    return route.fulfill({ json: type === 'artist' ? { artists: [], nextCursor: null } : type === 'album' ? { albums: [], nextCursor: null } : { songs: [song], nextCursor: null } })
  })
  await page.route('**/api/music/albums/MPRE_context', route => route.fulfill({ json: { id: 'MPRE_context', title: song.album, artists: [{ id: 'UC_context', name: song.artists[0] }], artwork: null, year: 2026, songs: [song] } }))
  await page.route('**/api/music/artists/UC_context', route => route.fulfill({ json: { id: 'UC_context', name: song.artists[0], artwork: null, banner: null, description: null, similar: [], topSongs: [song], albums: [], singles: [], expandable: { songs: false, albums: false, singles: false } } }))
}
async function listen(page: Page, request: APIRequestContext, key: string) {
  await expect.poll(() => page.locator('audio').evaluate(el => !(el as HTMLAudioElement).paused && (el as HTMLAudioElement).currentTime > .35)).toBe(true)
  await page.locator('audio').evaluate(el => (el as HTMLAudioElement).pause())
  await expect.poll(async () => (await recent(request)).items.map(card => card.key)).toContain(key)
}

test('records actual listening from favorites, playlists, albums, artists and individual songs', async ({ page, request }) => {
  test.setTimeout(90000)
  await mockCatalog(page)
  for (const [path, button, key] of [
    ['/favorites', 'Reproducir esta colección en aleatorio', 'favorites'],
    [`/playlist/${playlistId}`, `Reproducir ${song.title}`, `playlist:${playlistId}`],
    ['/music/album/MPRE_context', 'Reproducir álbum', 'album:youtube:MPRE_context'],
    ['/music/artist/UC_context', 'Reproducir', 'artist:youtube:UC_context'],
    ['/artist/Contexto%20Openfy', 'Reproducir esta colección', 'artist:Contexto Openfy'],
  ]) {
    await page.goto(path!)
    await page.getByRole('main').getByRole('button', { name: button!, exact: true }).click()
    await listen(page, request, key!)
  }
  await page.goto('/music/artist/UC_context')
  await page.getByRole('button', { name: `Reproducir ${song.title}`, exact: true }).click()
  await listen(page, request, `song:youtube:${song.videoId}`)
  const cards = (await recent(request)).items
  expect(cards.filter(card => card.key === `playlist:${playlistId}`)).toHaveLength(1)
  expect(cards.filter(card => card.key === `song:youtube:${song.videoId}`)).toHaveLength(1)
  expect(cards.find(card => card.key === 'album:youtube:MPRE_context')).toMatchObject({ title: song.album, subtitle: song.artists[0], artwork: null, item: null })
})

test('keeps a searched song independent of the playlist queue and restores both origins', async ({ page }, info) => {
  await mockCatalog(page); await page.goto(`/playlist/${playlistId}`)
  await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
  await expect.poll(async () => (await snapshot(page))?.queue[0]?.context).toEqual({ kind: 'playlist', id: playlistId })
  await page.goto('/search')
  await page.getByRole('tab', { name: 'Canciones', exact: true }).click()
  await page.getByRole('textbox', { name: 'Buscar en YouTube Music', exact: true }).fill(song.title)
  await addToQueue(page, info, song.title)
  await expect.poll(async () => (await snapshot(page))?.queue.length).toBe(2)
  expect((await snapshot(page)).queue.map(entry => entry.context)).toEqual([{ kind: 'playlist', id: playlistId }, { kind: 'song' }])
  await page.reload()
  await expect.poll(async () => (await snapshot(page))?.queue.map(entry => entry.context)).toEqual([{ kind: 'playlist', id: playlistId }, { kind: 'song' }])
  await page.goto('/library')
  await page.getByRole('textbox', { name: 'Filtrar canciones', exact: true }).fill(song.title)
  await page.getByRole('button', { name: 'Reproducir esta colección', exact: true }).click()
  await expect.poll(async () => (await snapshot(page))?.queue.length).toBe(1)
  expect((await snapshot(page)).queue[0]).not.toHaveProperty('context')
})
