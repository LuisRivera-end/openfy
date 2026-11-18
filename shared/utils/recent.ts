import type { ListeningContext, RecentCard } from '../types/telemetry'

export function contextKey(context: ListeningContext, trackKey: string): string {
  if (context.kind === 'song') return `song:${trackKey}`
  return context.kind === 'favorites' ? 'favorites' : `${context.kind}:${context.id}`
}

export function recentRoute(card: RecentCard): string | null {
  if (card.kind === 'song') return null
  if (card.kind === 'favorites') return '/favorites'
  if (!card.id) return null
  if (card.kind === 'playlist') return `/playlist/${encodeURIComponent(card.id)}`
  const catalog = card.id.startsWith('youtube:')
  return `${catalog ? '/music' : ''}/${card.kind}/${encodeURIComponent(catalog ? card.id.slice(8) : card.id)}`
}
