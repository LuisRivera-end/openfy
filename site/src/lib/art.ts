/**
 * Fictional albums for the device mockups. Covers are generated (gradients + shapes), so no real
 * music or artwork appears on the page.
 */
export interface Album { title: string; artist: string; colors: [string, string, string]; shape: 'orb' | 'rings' | 'wave' | 'grid' | 'sun' | 'stripes' }

export const ALBUMS: Album[] = [
  { title: 'Luz de Neón', artist: 'Valeria Sol', colors: ['#ff4d8d', '#6a2cff', '#12c2e9'], shape: 'orb' },
  { title: 'Marea Alta', artist: 'Los Faros', colors: ['#00c9a7', '#0b3d91', '#7ef9ff'], shape: 'wave' },
  { title: 'Ciudad Dormida', artist: 'Nube Norte', colors: ['#f7b733', '#fc4a1a', '#2b1055'], shape: 'sun' },
  { title: 'Órbita', artist: 'Kai Moreno', colors: ['#1ed760', '#0f2027', '#9cffb5'], shape: 'rings' },
  { title: 'Verano Eterno', artist: 'Ámbar', colors: ['#ffd86f', '#fc6262', '#ff9a8b'], shape: 'stripes' },
  { title: 'Norte', artist: 'Polar', colors: ['#a1c4fd', '#3f2b96', '#c2e9fb'], shape: 'grid' },
  { title: 'Café a las 3', artist: 'Marina Vega', colors: ['#c79081', '#3e2723', '#dfa579'], shape: 'orb' },
  { title: 'Eco', artist: 'Distrito 9', colors: ['#8e2de2', '#4a00e0', '#f000ff'], shape: 'rings' }
]

export const album = (index: number) => ALBUMS[((index % ALBUMS.length) + ALBUMS.length) % ALBUMS.length]!

function shapeSvg({ shape, colors: [, b, c] }: Album) {
  switch (shape) {
    case 'orb': return `<circle cx="60" cy="52" r="26" fill="${c}" opacity=".9"/><circle cx="60" cy="52" r="40" fill="none" stroke="${c}" stroke-opacity=".35" stroke-width="1.5"/>`
    case 'rings': return [14, 24, 34, 44].map((r, i) => `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${c}" stroke-opacity="${0.9 - i * 0.18}" stroke-width="3"/>`).join('')
    case 'wave': return [0, 1, 2, 3].map(i => `<path d="M0 ${62 + i * 12} Q30 ${50 + i * 12} 60 ${62 + i * 12} T120 ${62 + i * 12}" fill="none" stroke="${c}" stroke-opacity="${0.9 - i * 0.18}" stroke-width="3"/>`).join('')
    case 'sun': return `<circle cx="60" cy="70" r="30" fill="${c}"/>` + [0, 1, 2, 3].map(i => `<rect x="0" y="${72 + i * 8}" width="120" height="${2 + i}" fill="${b}" opacity=".9"/>`).join('')
    case 'grid': return Array.from({ length: 16 }, (_, i) => `<circle cx="${24 + (i % 4) * 24}" cy="${24 + Math.floor(i / 4) * 24}" r="${3 + ((i * 7) % 5)}" fill="${c}" opacity=".85"/>`).join('')
    case 'stripes': return [0, 1, 2, 3, 4].map(i => `<rect x="${-20 + i * 30}" y="-10" width="12" height="160" fill="${c}" opacity="${0.75 - i * 0.1}" transform="rotate(24 60 60)"/>`).join('')
  }
}

/** A square cover as inline HTML. `label` adds an accessible name; otherwise the cover is decorative. */
export function cover(index: number, className = '', label?: string) {
  const a = album(index)
  const [c1, c2] = a.colors
  const aria = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'
  return `<div class="cover ${className}" ${aria} style="--c1:${c1};--c2:${c2};--c3:${a.colors[2]}">` +
    `<svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice">${shapeSvg(a)}</svg></div>`
}

/** Palette used by the ambient renderer for an album. */
export const palette = (index: number) => album(index).colors
