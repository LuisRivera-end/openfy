import { artworkIdentity, artworkUrl, localArtwork, type ArtworkSize } from '../../shared/utils/artwork'
/** Use the saved cover even when a catalog card still holds a remote URL. */
export function useLocalArtwork(source: () => string | null | undefined) {
  const library = useLibraryStore(), downloads = useDownloadsStore()
  return computed(() => {
    const value = source()
    if (!value || value.startsWith('/api/artwork/')) return value
    const identity = artworkIdentity(value)
    for (const record of Object.values(downloads.records)) {
      if (record.assetId && record.entry?.source === 'youtube' && record.entry.song.artwork
        && artworkIdentity(record.entry.song.artwork) === identity) return localArtwork(record.artwork)
    }
    for (const saved of library.youtubeSongs) {
      if (saved.localAudio && saved.song.artwork && artworkIdentity(saved.song.artwork) === identity) return saved.localAudio.artwork
    }
    return value
  })
}
const ready = new Map<string, HTMLImageElement>()
const pending = new Map<string, Promise<HTMLImageElement>>()
let bytes = 0
export function decodedArtwork(url?: string) { return url && ready.get(url)?.src || undefined }
export async function loadArtwork(source: string, size: ArtworkSize) {
  const url = artworkUrl(source, size)!
  const cached = ready.get(url)
  if (cached) { ready.delete(url); ready.set(url, cached); return cached }
  const existing = pending.get(url)
  if (existing) return existing
  const work = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = async () => {
      await image.decode?.().catch(() => {})
      ready.set(url, image); bytes += image.naturalWidth * image.naturalHeight * 4
      for (const [key, old] of ready) {
        if (bytes <= 32 * 1024 ** 2) break
        if (key === url) continue
        bytes -= old.naturalWidth * old.naturalHeight * 4; ready.delete(key)
      }
      resolve(image)
    }
    image.onerror = () => reject(new Error('Portada no disponible'))
    image.src = url
  })
  pending.set(url, work)
  try { return await work } finally { pending.delete(url) }
}
