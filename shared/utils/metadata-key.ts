/** Accent-, case- and punctuation-insensitive key; drops “feat.” credits, keeps “(Remix)”. */
export function metadataKey(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('es')
    .replace(/[([](?:feat|ft|featuring|with|con)\b[^)\]]*[)\]]/g, ' ')
    .replace(/\s+(?:feat|ft|featuring)\.?\s.*$/, '')
    .replace(/\s+-\s+(?:single|ep)$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function artistParts(value: string) {
  return value.split(/\s*(?:,|&|\/|\bx\b|\by\b|\band\b|\bfeat\.?|\bft\.?)\s*/i).map(metadataKey).filter(Boolean)
}

export function sameArtist(result: { artistName?: string }, artists: string[]) {
  const parts = new Set([metadataKey(result.artistName || ''), ...artistParts(result.artistName || '')])
  return artists.some(artist => parts.has(metadataKey(artist)))
}
