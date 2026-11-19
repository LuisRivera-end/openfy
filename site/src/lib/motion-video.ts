export function watchMotionVideos(root: ParentNode) {
  const videos = root.querySelectorAll<HTMLVideoElement>('.motion-video')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const visible = new Set<HTMLVideoElement>()
  const threshold = 0.35

  function sync(video: HTMLVideoElement) {
    if (reduced.matches) {
      video.pause()
      video.classList.remove('is-playing')
      if (video.hasAttribute('src')) {
        video.removeAttribute('src')
        video.load()
      }
      return
    }
    if (document.hidden || !visible.has(video) || !video.getClientRects().length) {
      video.pause()
      return
    }
    if (!video.hasAttribute('src') && video.dataset.src) video.src = video.dataset.src
    if (video.paused) void video.play().catch(() => {})
  }

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const video = entry.target as HTMLVideoElement
      if (entry.isIntersecting && entry.intersectionRatio >= threshold) visible.add(video)
      else visible.delete(video)
      sync(video)
    }
  }, { threshold })

  for (const video of videos) {
    video.addEventListener('playing', () => {
      if (!reduced.matches) video.classList.add('is-playing')
    })
    video.addEventListener('error', () => video.classList.remove('is-playing'))
    observer.observe(video)
  }
  const syncAll = () => videos.forEach(sync)
  document.addEventListener('visibilitychange', syncAll)
  reduced.addEventListener('change', syncAll)
}
