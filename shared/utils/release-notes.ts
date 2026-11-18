export type ReleaseNoteType = 'new' | 'improved' | 'fixed'
export type ReleaseNoteItem = { type: ReleaseNoteType, text: string }
export type ReleaseNote = { version: string, date: string, summary?: string, items: ReleaseNoteItem[] }

export const RELEASE_NOTE_LABELS: Record<ReleaseNoteType, string> = { new: 'Nuevo', improved: 'Mejora', fixed: 'Arreglo' }

const VERSION = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/

export function parseReleaseVersion(value: unknown): [number, number, number] | null {
  const match = typeof value === 'string' ? VERSION.exec(value.trim()) : null
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareReleaseVersions(left: [number, number, number], right: [number, number, number]) {
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1
  return 0
}

/** Notes to show after an update: every release in (lastSeen, current], newest first; only `current` when there is no valid history. Build numbers are ignored. */
export function releasesSince<T extends { version: string }>(releases: readonly T[], lastSeen: string | null | undefined, current: string): T[] {
  const now = parseReleaseVersion(current)
  if (!now) return []
  const seen = parseReleaseVersion(lastSeen)
  const picked = releases.filter((release) => {
    const version = parseReleaseVersion(release.version)
    if (!version) return false
    if (!seen) return compareReleaseVersions(version, now) === 0
    return compareReleaseVersions(version, seen) > 0 && compareReleaseVersions(version, now) <= 0
  })
  return picked.sort((left, right) => compareReleaseVersions(parseReleaseVersion(right.version)!, parseReleaseVersion(left.version)!))
}
