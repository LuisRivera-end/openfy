/**
 * App-scoped keyboard and mouse shortcuts, shared by the web/PWA and the Windows app (Openfy.Core/Shortcuts.cs).
 * They only act while the Openfy tab or window has focus. `tests/fixtures/shortcuts-contract.json` pins both sides.
 *
 * Keys are canonical names, not layout characters: letters in upper case ("K"), "Space", "ArrowLeft"…, "F11",
 * "Escape", "BrowserBack"/"BrowserForward" (keyboard keys) and "MouseBack"/"MouseForward" (side buttons).
 */
export type ShortcutCommand =
  | 'toggle-playback' | 'next' | 'previous' | 'seek-forward' | 'seek-backward'
  | 'volume-up' | 'volume-down' | 'mute' | 'shuffle' | 'repeat' | 'favorite'
  | 'big-picture' | 'queue' | 'lyrics' | 'search' | 'back' | 'forward' | 'close'

export interface ShortcutInput {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  /** Command on macOS, the Windows key elsewhere: never claimed. */
  meta?: boolean
  /** Focus is in a text field, a select or a contenteditable element. */
  editable?: boolean
}

interface Binding { key: string, ctrl?: boolean, shift?: boolean, alt?: boolean }

/** Seconds moved by seek-forward/seek-backward and the volume step of volume-up/volume-down. */
export const SHORTCUT_SEEK_SECONDS = 10
export const SHORTCUT_VOLUME_STEP = 0.1

const BINDINGS: Record<ShortcutCommand, Binding[]> = {
  'toggle-playback': [{ key: 'Space' }, { key: 'K' }],
  'next': [{ key: 'ArrowRight', ctrl: true }],
  'previous': [{ key: 'ArrowLeft', ctrl: true }],
  'seek-forward': [{ key: 'ArrowRight', shift: true }],
  'seek-backward': [{ key: 'ArrowLeft', shift: true }],
  'volume-up': [{ key: 'ArrowUp', ctrl: true }],
  'volume-down': [{ key: 'ArrowDown', ctrl: true }],
  'mute': [{ key: 'M' }],
  'shuffle': [{ key: 'A' }],
  'repeat': [{ key: 'R' }],
  'favorite': [{ key: 'F' }],
  'big-picture': [{ key: 'B' }, { key: 'F11' }],
  'queue': [{ key: 'C' }],
  'lyrics': [{ key: 'L' }],
  'search': [{ key: 'K', ctrl: true }],
  'back': [{ key: 'ArrowLeft', alt: true }, { key: 'BrowserBack' }, { key: 'MouseBack' }],
  'forward': [{ key: 'ArrowRight', alt: true }, { key: 'BrowserForward' }, { key: 'MouseForward' }],
  'close': [{ key: 'Escape' }],
}

/** Keys that still act while typing: they never produce text and a text field gives them no meaning. */
const WHILE_TYPING = new Set(['F11', 'BrowserBack', 'BrowserForward', 'MouseBack', 'MouseForward'])

export function shortcutCommand(input: ShortcutInput): ShortcutCommand | null {
  if (input.meta) return null
  if (input.editable && !WHILE_TYPING.has(input.key)) return null
  for (const [command, bindings] of Object.entries(BINDINGS) as [ShortcutCommand, Binding[]][]) {
    if (bindings.some(binding => binding.key === input.key && !!binding.ctrl === !!input.ctrl && !!binding.shift === !!input.shift && !!binding.alt === !!input.alt)) return command
  }
  return null
}

/** Canonical key of a DOM keyboard event, independent of the keyboard layout for letters (uses `code`). */
export function shortcutKey(event: { key: string, code?: string }): string {
  if (event.code && /^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (event.key === ' ' || event.code === 'Space') return 'Space'
  if (event.key === 'Esc') return 'Escape'
  return event.key.length === 1 ? event.key.toUpperCase() : event.key
}

/** Canonical key of a DOM mouse button (3 = back, 4 = forward), or null for the others. */
export function shortcutMouseKey(button: number): string | null {
  return button === 3 ? 'MouseBack' : button === 4 ? 'MouseForward' : null
}

/** The list shown in Ajustes, in this order, on both clients. */
export const SHORTCUT_GUIDE: { keys: string, label: string }[] = [
  { keys: 'Espacio · K', label: 'Reproducir o pausar' },
  { keys: 'Ctrl + → · Ctrl + ←', label: 'Siguiente o anterior canción' },
  { keys: 'Mayús + → · Mayús + ←', label: `Avanzar o retroceder ${SHORTCUT_SEEK_SECONDS} s` },
  { keys: 'Ctrl + ↑ · Ctrl + ↓', label: 'Subir o bajar el volumen' },
  { keys: 'M', label: 'Silenciar o reactivar el sonido' },
  { keys: 'A', label: 'Activar o desactivar el aleatorio' },
  { keys: 'R', label: 'Cambiar la repetición' },
  { keys: 'F', label: 'Añadir o quitar de favoritos' },
  { keys: 'B · F11', label: 'Abrir o cerrar Big Picture' },
  { keys: 'C', label: 'Mostrar u ocultar la cola' },
  { keys: 'L', label: 'Mostrar u ocultar la letra' },
  { keys: 'Ctrl + K', label: 'Buscar' },
  { keys: 'Alt + ← · botón lateral trasero', label: 'Volver a la página anterior' },
  { keys: 'Alt + → · botón lateral delantero', label: 'Ir a la página siguiente' },
  { keys: 'Esc', label: 'Salir de Big Picture o cerrar el panel' },
]
