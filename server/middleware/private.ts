export default defineEventHandler((event) => {
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Referrer-Policy', 'same-origin')
  setHeader(event, 'X-Frame-Options', 'DENY')
  const requestHost = getHeader(event, 'host') || ''
  const hostname = requestHost.replace(/:\d+$/, '')
  const privateHost = process.env.OPENFY_ORIGIN ? new URL(process.env.OPENFY_ORIGIN).host : ''
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname) && requestHost !== privateHost) {
    throw createError({ statusCode: 403, message: 'Configura OPENFY_ORIGIN con la dirección HTTPS privada de esta biblioteca.' })
  }
  if (!event.path.startsWith('/api/')) return
  setHeader(event, 'Cache-Control', 'no-store')
  const fetchSite = getHeader(event, 'sec-fetch-site')
  if (fetchSite === 'cross-site') throw createError({ statusCode: 403, message: 'Usa la dirección privada de Openfy.' })
  if (['GET', 'HEAD'].includes(event.method)) return
  const origin = getHeader(event, 'origin')
  // A reverse proxy may preserve or rewrite Host. Trust only the configured
  // private origin or direct same-origin loopback access, never forwarded headers.
  const directLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  const configuredOrigin = process.env.OPENFY_ORIGIN ? new URL(process.env.OPENFY_ORIGIN).origin : ''
  if (origin && origin !== configuredOrigin && !(directLoopback && new URL(origin).host === requestHost)) {
    throw createError({ statusCode: 403, message: 'El origen de la solicitud no coincide.' })
  }
})
