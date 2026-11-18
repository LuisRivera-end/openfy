export const useUpdatesStore = defineStore('updates', () => {
  const player = usePlayerStore(), library = useLibraryStore()
  const telemetry = useTelemetryStore()
  const available = ref(false), status = ref(''), checking = ref(false)
  let registration: ServiceWorkerRegistration | undefined, pending = false, prepared = false, reloading = false
  let idleSince = Date.now(), postponed = 0, nextCheck = 0
  let unlock: ReturnType<typeof setTimeout> | undefined
  const markActive = () => { idleSince = Date.now() }
  function busy() {
    return !player.readyForUpdate() || library.jobs.some(job => job.state === 'processing') || library.tracks.some(track => track.conversion === 'running')
  }
  function release() { if (unlock) clearTimeout(unlock); if (prepared) { document.body.inert = false; player.cancelTabCheckpoint() } prepared = false }
  async function message(event: MessageEvent) {
    if (event.data?.type === 'OPENFY_UPDATE_RELEASE') { release(); return }
    if (event.data?.type !== 'OPENFY_UPDATE_PREPARE' || !event.ports[0]) return
    let ready = !busy() && (!event.data.automatic || Date.now() - idleSince >= 60_000 && Date.now() >= postponed)
    try {
      if (ready) {
        document.body.inert = true; prepared = true
        player.checkpointTab()
        await telemetry.checkpoint()
        ready = !busy()
        unlock = setTimeout(release, 15000)
      }
    } catch { ready = false }
    if (!ready) release()
    event.ports[0].postMessage({ ready })
  }
  let described: ServiceWorker | undefined
  function describe(worker: ServiceWorker) {
    if (worker === described) return
    described = worker
    const channel = new MessageChannel()
    const timeout = setTimeout(() => channel.port1.close(), 3000)
    channel.port1.onmessage = event => {
      clearTimeout(timeout); channel.port1.close()
      if (typeof event.data === 'string') status.value = 'Openfy ' + event.data + ' está disponible.'
    }
    worker.postMessage({ type: 'OPENFY_VERSION' }, [channel.port2])
  }
  async function check() {
    if (checking.value) return
    if (!registration) { status.value = 'Este navegador aún no ha registrado la aplicación para uso sin conexión.'; return }
    checking.value = true; nextCheck = Date.now() + 4 * 3600_000
    try {
      await registration.update()
      available.value = !!registration.waiting
      status.value = available.value ? 'Hay una actualización de Openfy.' : 'Tienes la versión más reciente.'
      if (registration.waiting) describe(registration.waiting)
    } catch { status.value = 'No se pudo comprobar la actualización. Comprueba la conexión con tu PC.' }
    finally { checking.value = false }
  }
  function postpone() {
    postponed = Date.now() + 2 * 3600_000
    localStorage.setItem('openfy-update-postponed', String(postponed))
    status.value = 'Actualización pospuesta durante dos horas.'
  }
  async function waitingWorker() {
    if (registration?.waiting) return registration.waiting
    // After a long suspension (iOS standalone apps) the cached registration can be stale.
    try {
      registration = await navigator.serviceWorker.getRegistration() ?? registration
      if (!registration?.waiting) await registration?.update()
    } catch { /* Reported through the status below. */ }
    return registration?.waiting ?? undefined
  }
  async function apply(manual = true) {
    if (pending) { if (manual) status.value = 'La actualización ya está en curso.'; return }
    if (manual) status.value = 'Preparando la actualización…'
    const worker = await waitingWorker()
    if (!worker) {
      if (!manual) return
      if (registration?.installing) { status.value = 'Descargando la actualización…'; return }
      available.value = false; status.value = 'Tienes la versión más reciente.'
      return
    }
    if (manual && player.playing) {
      player.toggle()
      // 'pause' is dispatched asynchronously; busy() must not run before it lands.
      for (let waited = 0; (player.playing || player.buffering) && waited < 2000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (busy()) { markActive(); status.value = 'La actualización espera a que terminen las operaciones activas.'; return }
    if (pending) return
    pending = true
    const channel = new MessageChannel()
    const done = () => { pending = false; channel.port1.close() }
    const deadline = setTimeout(() => { done(); markActive(); status.value = 'La actualización está pendiente. Openfy se reiniciará en cuanto el navegador la active.' }, 10000)
    channel.port1.onmessage = event => {
      clearTimeout(deadline); done()
      if (!event.data.ready) { markActive(); status.value = 'Otra pestaña aún está en uso.' }
    }
    worker.postMessage({ type: 'OPENFY_UPDATE', automatic: !manual }, [channel.port2])
  }
  // A tab frozen in the background (iOS) can miss the update vote; it reloads once it is safe.
  // controllerchange events queued while frozen are delivered when the tab resumes.
  let controlled = false, stale = false
  function controllerChanged() {
    // The first install claims an uncontrolled page; only a replaced controller means old code.
    if (controlled) stale = true
    controlled = !!navigator.serviceWorker.controller
    void reloadIfStale()
  }
  async function reloadIfStale() {
    if (!stale || reloading || prepared || document.hidden || busy()) return
    reloading = true
    player.checkpointTab()
    try { await telemetry.checkpoint() } catch { /* The reload must not wait on telemetry. */ }
    location.reload()
  }
  async function initialize() {
    if (!('serviceWorker' in navigator)) return
    controlled = !!navigator.serviceWorker.controller
    navigator.serviceWorker.addEventListener('message', message)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return
      if (prepared) { reloading = true; location.reload(); return }
      controllerChanged()
    })
    document.addEventListener('visibilitychange', () => { void reloadIfStale() })
    registration = await navigator.serviceWorker.ready
    postponed = Number(localStorage.getItem('openfy-update-postponed')) || 0
    window.addEventListener('storage', event => { if (event.key === 'openfy-update-postponed') postponed = Number(event.newValue) || 0 })
    for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, markActive, { passive: true, capture: true })
    window.addEventListener('online', check)
    window.addEventListener('pageshow', () => { if (Date.now() >= nextCheck) void check() })
    void check()
    setInterval(() => {
      if (document.hidden) return
      if (stale) { void reloadIfStale(); return }
      if (Date.now() >= nextCheck) void check()
      if (!registration?.waiting) return
      if (!available.value) { available.value = true; markActive(); status.value = 'Hay una actualización de Openfy.'; describe(registration.waiting) }
      if (busy()) { markActive(); return }
      if (Date.now() < postponed || pending) return
      const seconds = Math.floor((Date.now() - idleSince) / 1000)
      if (seconds >= 90) void apply(false)
      else if (seconds >= 60) status.value = `Openfy se reiniciará en ${90 - seconds} segundos.`
    }, 1000)
  }
  return { available, status, checking, initialize, check, apply, postpone }
})
