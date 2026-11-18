export class MusicProviderError extends Error {
  constructor(public code: string, message: string, public statusCode = 503, public details?: Record<string, string | number>) { super(message) }
}

/** Local diagnostics only. Never log signed stream URLs, tokens, or response bodies. */
export function logMusicFailure(stage: string, videoId: string, error: unknown, details: Record<string, string | number> = {}) {
  const failure = error instanceof Error ? error : new Error('Unknown provider failure')
  const clean = (value: string) => value.replace(/https?:\/\/\S+/g, '[url]').slice(0, 240)
  const context = Object.fromEntries(Object.entries({ ...(error instanceof MusicProviderError ? error.details : {}), ...details })
    .map(([key, value]) => [key, typeof value === 'string' ? clean(value) : value]))
  const cause = failure.cause as { code?: unknown; errors?: { code?: unknown }[] } | undefined
  const networkCode = typeof cause?.code === 'string' ? cause.code : cause?.errors?.map(item => item.code).filter(code => typeof code === 'string').join(',')
  console.warn('[youtube-music]', JSON.stringify({ at: new Date().toISOString(), stage, videoId, ...(networkCode ? { networkCode } : {}),
    code: error instanceof MusicProviderError ? error.code : failure.name,
    message: clean(failure.message), ...context }))
}
