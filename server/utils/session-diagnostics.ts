import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

export function diagnosticTarget(value: string) {
  try { const url = new URL(value); return url.origin + url.pathname } catch { return value.split('?')[0] || '' }
}
export function sessionDiagnostic(operation: string, outcome: string, fields: Record<string, string | number | null | undefined> = {}) {
  const directory = process.env.OPENFY_SESSION_LOG_DIR
  if (!directory) return
  try {
    const safe = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'string'
      ? value.replace(/https?:\/\/[^\s"<>]+/g, url => diagnosticTarget(url)).slice(0, 2000) : value]))
    appendFileSync(join(directory, 'backend.jsonl'), JSON.stringify({ at: new Date().toISOString(), session: process.env.OPENFY_SESSION_ID, operation, outcome, ...safe }) + '\n')
  } catch { /* Logging never changes request outcomes. */ }
}

export function diagnosticError(error: unknown) {
  const failure = error as { name?: string; message?: string; statusCode?: number; status?: number; code?: string; cause?: { code?: string } }
  return { errorType: failure?.name, error: failure?.message || 'Unknown error', code: failure?.code || failure?.cause?.code, status: failure?.statusCode ?? failure?.status }
}
