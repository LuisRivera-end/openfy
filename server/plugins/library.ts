import { startWorkers, stopWorkers } from '../utils/workers'
import { closeDatabase } from '../database'
import { startDesktopBridge } from '../utils/desktop-bridge'
import { notifyDesktop } from '../utils/desktop-events'
import { isMaintenance, acknowledgeClose } from '../utils/update-maintenance'
import { reconcileOfflineCollections } from '../utils/audio-downloads'
import { DownloadedLyricsBackfill } from '../utils/downloaded-lyrics'

export default defineNitroPlugin((nitro) => {
  // Prerendering builds the shell only, without touching the user's library.
  if (import.meta.prerender) return
  if (!isMaintenance()) startWorkers()
  const lyricsBackfill = new DownloadedLyricsBackfill()
  if (!isMaintenance() && process.env.OPENFY_LYRICS_BACKFILL !== 'off') lyricsBackfill.start()
  const closeBridge = startDesktopBridge()
  nitro.hooks.hook('afterResponse', event => {
    if (['PUT', 'DELETE'].includes(event.method) && /^\/api\/playlists\//.test(event.path)) reconcileOfflineCollections()
    if (['POST', 'PUT', 'DELETE'].includes(event.method) && /^\/api\/(?:imports|playlists|tracks|conversions|music\/saved)(?:\/|$)/.test(event.path)) notifyDesktop('libraryChanged')
  })
  nitro.hooks.hook('close', async () => { await Promise.all([stopWorkers(), lyricsBackfill.stop()]); closeDatabase(); await acknowledgeClose(); closeBridge() })
})
