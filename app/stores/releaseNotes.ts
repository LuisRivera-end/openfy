import { defineStore } from 'pinia'
import notes from '../../shared/release-notes.json'
import { parseReleaseVersion, releasesSince, type ReleaseNote } from '../../shared/utils/release-notes'

const SEEN_KEY = 'openfy-release-seen'

/** Per-device "Novedades": the notes of every version installed since this browser last closed the dialog. */
export const useReleaseNotesStore = defineStore('releaseNotes', () => {
  const version = useRuntimeConfig().public.release.version
  const releases = notes.releases as ReleaseNote[]
  const shown = ref<ReleaseNote[]>([])
  const since = ref<string | null>(null)
  const open = ref(false)
  function seen() { try { return localStorage.getItem(SEEN_KEY) } catch { return null } }
  function remember() { try { localStorage.setItem(SEEN_KEY, version) } catch {} }
  function initialize() {
    if (!import.meta.client || open.value) return
    const last = seen()
    const pending = releasesSince(releases, last, version)
    if (!pending.length) { if (last !== version) remember(); return }
    shown.value = pending
    since.value = pending.length > 1 && parseReleaseVersion(last) ? last : null
    open.value = true
  }
  function history() {
    shown.value = releases.filter(release => releasesSince([release], '0.0.0', version).length)
    since.value = null
    open.value = true
  }
  function close() {
    if (!open.value) return
    open.value = false
    remember()
  }
  return { shown, since, open, initialize, history, close }
})
