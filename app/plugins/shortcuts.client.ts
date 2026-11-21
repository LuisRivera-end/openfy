import { SHORTCUT_SEEK_SECONDS, SHORTCUT_VOLUME_STEP, shortcutCommand, shortcutKey, shortcutMouseKey, type ShortcutCommand } from '../../shared/utils/shortcuts'

/** Text entry keeps every key it can type or edit with; range, checkbox and button inputs do not. */
const TEXT_INPUT = /^(?:text|search|url|email|password|number|tel|date|datetime-local|month|time|week)$/
function editable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && TEXT_INPUT.test(target.type)
}
/** Space activates the focused control; only a non-interactive target makes it play or pause. */
function activatesWithSpace(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="slider"], [role="menuitem"], [role="option"]')
}
/** Any modal other than the expanded player owns the keyboard (dialogs, sheets, confirmations). */
function otherModalOpen() {
  return [...document.querySelectorAll('dialog[open]')].some(dialog => !dialog.classList.contains('immersive'))
}

/**
 * App-scoped shortcuts (shared/utils/shortcuts.ts): they only act while this tab has focus and never inside a text
 * field. The browser keeps its own Back/Forward (Alt+arrows, the mouse side buttons); they are only taken over to close
 * the expanded player, which on desktop has no history entry of its own. Escape stays with each surface.
 */
export default defineNuxtPlugin(() => {
  const player = usePlayerStore(), library = useLibraryStore(), lyrics = useLyricsStore(), startup = useStartupStore()
  let unmuted = 1

  function run(command: ShortcutCommand, key: string): boolean {
    const current = player.queue[player.index]
    switch (command) {
      case 'toggle-playback': if (!player.current) return false; player.toggle(); return true
      case 'next': player.advance(1); return true
      case 'previous': player.advance(-1); return true
      case 'seek-forward': case 'seek-backward':
        if (!player.current) return false
        player.seek(player.livePosition() + (command === 'seek-forward' ? SHORTCUT_SEEK_SECONDS : -SHORTCUT_SEEK_SECONDS)); return true
      case 'volume-up': case 'volume-down':
        player.setVolume(Math.round((player.volume + (command === 'volume-up' ? SHORTCUT_VOLUME_STEP : -SHORTCUT_VOLUME_STEP)) * 100) / 100); return true
      case 'mute':
        if (player.volume > 0) { unmuted = player.volume; player.setVolume(0) } else player.setVolume(unmuted || 1)
        return true
      case 'shuffle': if (!player.current) return false; player.toggleShuffle(); return true
      case 'repeat': player.cycleRepeat(); return true
      case 'favorite':
        if (!current || !library.connected) return false
        if (current.source === 'youtube') void library.favoriteYouTube(current.song)
        else void library.favorite(current.trackId)
        return true
      case 'big-picture':
        if (!player.expanded && !player.current) return false
        player.expanded = !player.expanded
        // F11 also toggles the browser's own full screen; leave it to the browser.
        return key !== 'F11'
      case 'queue':
        player.expanded = false; player.queueOpen = !player.queueOpen; return true
      case 'lyrics':
        if (!player.current || player.expanded) return false
        lyrics.panelOpen = !lyrics.panelOpen; return true
      case 'search': {
        player.expanded = false
        const field = document.getElementById('global-search') as HTMLInputElement | null
        if (!field) return false
        field.focus(); field.select(); return true
      }
      case 'back': case 'forward':
        if (!player.expanded) return false
        player.expanded = false; return true
      default: return false
    }
  }

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing || startup.blocked || otherModalOpen()) return
    const key = shortcutKey(event)
    // Holding a key repeats seek and volume only; a repeated toggle would flicker.
    if (event.repeat && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return
    if (key === 'Space' && activatesWithSpace(event.target) && !editable(event.target)) return
    const command = shortcutCommand({ key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, editable: editable(event.target) })
    if (!command) return
    // Every other surface already closes itself with Escape; the docked lyrics panel did not.
    if (command === 'close') { if (lyrics.panelOpen && !player.expanded) { lyrics.panelOpen = false; event.preventDefault() } return }
    if (run(command, key)) { event.preventDefault(); announce(command) }
  })

  // Shortcuts change state that is not on screen (volume, shuffle): screen readers hear it through a polite region.
  const status = document.createElement('div')
  status.setAttribute('role', 'status'); status.className = 'sr-only'
  document.body.append(status)
  function announce(command: ShortcutCommand) {
    const text = command === 'volume-up' || command === 'volume-down' || command === 'mute' ? (player.volume ? `Volumen ${Math.round(player.volume * 100)} %` : 'Sonido silenciado')
      : command === 'shuffle' ? (player.shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado')
        : command === 'repeat' ? ({ off: 'Repetición desactivada', all: 'Repetir toda la cola', one: 'Repetir una canción' }[player.repeat] ?? '')
          : ''
    if (text) status.textContent = text
  }

  // Chromium navigates on the side button's mouseup; cancelling it there keeps the page while the player closes.
  const side = (event: MouseEvent) => {
    const key = shortcutMouseKey(event.button)
    if (!key || startup.blocked || otherModalOpen() || !player.expanded) return
    event.preventDefault()
    if (event.type === 'mouseup') run(key === 'MouseBack' ? 'back' : 'forward', key)
  }
  window.addEventListener('mousedown', side)
  window.addEventListener('mouseup', side)
})
