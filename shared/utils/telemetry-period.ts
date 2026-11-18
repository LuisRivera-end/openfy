import type { ListeningPeriod } from '../types/telemetry'
export function parseListeningPeriod(value: unknown): ListeningPeriod { return ['7d', '30d', 'year', 'all'].includes(String(value)) ? value as ListeningPeriod : '30d' }
