// The only network entry point is the local reverse proxy (Tailscale Serve).
process.env.NITRO_HOST = '127.0.0.1'
process.env.NITRO_PORT ||= '3000'
// Nitro logs uncaught listener errors but can otherwise remain alive with an
// initialized SQLite database and no HTTP socket. Fail closed on port conflicts.
process.on('uncaughtExceptionMonitor', error => {
  if (error.code === 'EADDRINUSE') setImmediate(() => process.exit(1))
})
await import('../.output/server/index.mjs')
