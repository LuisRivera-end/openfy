export const AUDIO_CACHE = 'openfy-audio-v1'
export const ARTWORK_CACHE = 'openfy-artwork-v1'
export const assetUrl = (id: string) => `/api/assets/${encodeURIComponent(id)}`
/** Streaming URL for an asset that is not downloaded; the service worker leaves it to the network. */
export const STREAM_PARAM = 'stream'
export const streamingAssetUrl = (id: string) => `${assetUrl(id)}?${STREAM_PARAM}=1`
export const formatTime = (seconds: number) => {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
export const formatCollectionDuration = (seconds: number) => {
  const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.floor(seconds / 60)) : 0
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}
export const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
