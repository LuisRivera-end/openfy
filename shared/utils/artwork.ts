/** 2048 is reserved for wide artist banners; square covers stop at 1024. */
export const ARTWORK_SIZES = [128, 512, 1024, 2048] as const
export type ArtworkSize = typeof ARTWORK_SIZES[number]
/** Older device downloads could persist the provider URL when a cover failed. */
export const localArtwork = (source?: string | null): string | null =>
  source && /^\/api\/artwork\/[a-f0-9]{64}\.webp(?:\?|$)/.test(source) ? source : null
export function artworkSize(value: unknown): ArtworkSize {
  const size = Number(value)
  return size <= 128 ? 128 : size <= 512 ? 512 : size <= 1024 ? 1024 : 2048
}
export function artworkUrl(source?: string | null, size: ArtworkSize = 128): string | undefined {
  if (!source) return
  if (source.startsWith('/api/artwork/')) return /^[\w/.-]+\.webp$/.test(source) ? source + '?size=' + size : source
  return `/api/artwork/remote?url=${encodeURIComponent(source)}&size=${size}&v=4`
}
/** Only strip the verified Google size suffix; preserve crop, identity and query. */
export function artworkIdentity(value: string): string {
  return value.replace(/=w\d+-h\d+(?=-|$)/, '=wSIZE-hSIZE').replace(/=s\d+(?=-|$)/, '=sSIZE')
}
export const isVideoThumbnail = (value: string) => {
  try { return /(^|\.)ytimg\.com$/.test(new URL(value).hostname) } catch { return false }
}
/** Ask the provider for its largest rendition. Wide images (banners) get 2048 px of width. */
export function largeArtworkUrl(value: string): string {
  const url = new URL(value)
  if (/(^|\.)(googleusercontent\.com|ggpht\.com)$/.test(url.hostname)) {
    const box = /=w(\d+)-h(\d+)(?=-|$)/.exec(value)
    if (box && Number(box[1]) >= Number(box[2]) * 1.5)
      return value.replace(box[0], `=w2048-h${Math.round(2048 * Number(box[2]) / Number(box[1]))}`)
    return value.replace(/=w\d+-h\d+(?=-|$)/, '=w1024-h1024').replace(/=s\d+(?=-|$)/, '=s1024')
  }
  const video = /^\/vi(?:_webp)?\/([\w-]{11})\/[\w]+\.(?:jpg|webp)$/.exec(url.pathname)
  if (/(^|\.)ytimg\.com$/.test(url.hostname) && video) return `https://i.ytimg.com/vi/${video[1]}/maxresdefault.jpg`
  return value
}
