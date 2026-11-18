import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { diagnosticError, diagnosticTarget, sessionDiagnostic } from '../../server/utils/session-diagnostics'

it('records request evidence without signed queries or credentials and tolerates unavailable logging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openfy-session-'))
  const previous = process.env.OPENFY_SESSION_LOG_DIR
  try {
    process.env.OPENFY_SESSION_LOG_DIR = directory
    sessionDiagnostic('http.outgoing', 'failed', { target: diagnosticTarget('https://user:password@example.com/image?token=secret'), status: 503, elapsedMs: 25, error: 'Failed https://example.com/image?token=secret' })
    const log = await readFile(join(directory, 'backend.jsonl'), 'utf8')
    expect(log).not.toContain('secret'); expect(log).not.toContain('password')
    expect(JSON.parse(log)).toMatchObject({ operation: 'http.outgoing', status: 503, elapsedMs: 25, target: 'https://example.com/image' })
    expect(diagnosticError({ name: 'Error', message: 'Invalid request', statusCode: 400 })).toMatchObject({ status: 400, error: 'Invalid request' })
    process.env.OPENFY_SESSION_LOG_DIR = join(directory, 'missing')
    expect(() => sessionDiagnostic('test', 'failed')).not.toThrow()
  } finally {
    if (previous === undefined) delete process.env.OPENFY_SESSION_LOG_DIR
    else process.env.OPENFY_SESSION_LOG_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})
