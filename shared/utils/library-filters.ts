import type { LibraryItem } from '../types/music'
import type { LibraryFilters, TrackStatistics } from '../types/telemetry'

export const normalizeLibraryText = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
export function defaultLibraryFilters(): LibraryFilters { return { query: '', artist: '', album: '', genre: '', favorite: false, source: 'all', downloaded: false, sort: 'default', direction: 'asc' } }
/** Collection views expose search, downloads and column sorting; ranking keeps its own filters. */
export function collectionLibraryFilters(filters: LibraryFilters): LibraryFilters {
  return { ...filters, artist: '', album: '', genre: '', favorite: false, source: 'all' }
}
export function filterLibrary(items: LibraryItem[], filters: LibraryFilters, stats: Record<string, TrackStatistics> = {}, downloaded = new Set<string>()) {
  const query = normalizeLibraryText(filters.query)
  const result = items.filter(item => (!query || normalizeLibraryText(`${item.title} ${item.artist} ${item.album}`).includes(query))
    && (!filters.artist || normalizeLibraryText(item.artist) === normalizeLibraryText(filters.artist))
    && (!filters.album || normalizeLibraryText(item.album) === normalizeLibraryText(filters.album))
    && (!filters.genre || (item.genres?.length ? item.genres : ['Sin género']).some(genre => normalizeLibraryText(genre) === normalizeLibraryText(filters.genre)))
    && (!filters.favorite || item.favorite) && (filters.source === 'all' || item.source === filters.source)
    && (!filters.downloaded || downloaded.has(item.id)))
  if (filters.sort !== 'default') result.sort((a, b) => {
    const value = (item: LibraryItem): string | number => {
      switch (filters.sort) {
        case 'plays': return stats[item.id]?.plays || 0
        case 'minutes': return stats[item.id]?.listenedMs || 0
        case 'favorite': return Number(item.favorite)
        case 'genre': return item.genres?.join(', ') || 'Sin género'
        case 'addedAt': return item.addedAt || 0
        case 'duration': return item.duration
        default: return item[filters.sort as 'title' | 'artist' | 'album']
      }
    }
    const left = value(a), right = value(b)
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'es', { sensitivity: 'base' })
    return order * (filters.direction === 'desc' ? -1 : 1) || a.title.localeCompare(b.title, 'es') || a.id.localeCompare(b.id)
  })
  return result
}
