import type { YouTubeSong } from './music'

export interface SyncPlaylist { name: string; trackIds: string[]; songs: YouTubeSong[] }
export interface SyncFavorite { song: YouTubeSong; favorite: boolean }
export interface SyncOperation {
  operationId: string; sequence: number; kind: 'favorite' | 'playlist' | 'deletePlaylist'
  entityId: string; baseRevision: number; payload: SyncFavorite | SyncPlaylist | Record<string, never>
}
export interface SyncChange {
  cursor: number; kind: 'favorite' | 'playlist'; entityId: string; revision: number
  deleted: boolean; payload: SyncFavorite | SyncPlaylist | null
}
export interface SyncAcknowledgement { operationId: string; entityId: string; revision: number; conflictId?: string }
export interface SyncExchange { acknowledgements: SyncAcknowledgement[]; changes: SyncChange[]; cursor: number; hasMore: boolean }
