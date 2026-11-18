export const DESKTOP_PROTOCOL = 1
export interface DesktopRequest { id: string; method: 'resolveAsset' | 'importPaths' | 'prepareArtwork' | 'subscribe' | 'shutdown' | 'updateReadiness' | 'beginMaintenance' | 'cancelMaintenance' | 'createPairing' | 'listSyncDevices' | 'revokeSyncDevice'; params?: Record<string, unknown> }
export interface DesktopReply { id: string; result?: unknown; error?: string }
