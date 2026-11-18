import { countOperation, isMaintenance } from '../utils/update-maintenance'
export default defineEventHandler(event => {
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/') || path === '/api/activity') return
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(event.method)
  const transfer = path.startsWith('/api/assets/') || path.endsWith('/stream')
  if (!mutation && !transfer) return
  if (isMaintenance()) { setHeader(event, 'Retry-After', 5); throw createError({ statusCode: 503, statusMessage: 'Openfy se está actualizando' }) }
  const finish = countOperation()
  event.node.res.once('finish', finish); event.node.res.once('close', finish)
})
